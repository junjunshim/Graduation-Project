#ifndef _GNU_SOURCE
#define _GNU_SOURCE
#endif

#include "GitRunner.h"

#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cstddef>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <system_error>

#include <drogon/drogon.h>

#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <spawn.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

// libc 가 제공하는 환경변수 배열. execve 에 넘길 envp 를 만들 때 쓴다.
// 익명 네임스페이스 안에 두면 내부 링키지가 되어 링크 에러가 나므로 전역에 둔다.
extern char **environ;

namespace {

// git 이 자격 증명을 물어볼 때 실행하는 스크립트.
// 프롬프트 문자열에 따라 아이디와 토큰을 구분해 돌려주고, 토큰은 환경변수로만 전달한다
// (argv·remote URL·.git/config 어디에도 남기지 않기 위함).
const char *kAskpassScript =
    "#!/bin/sh\n"
    "case \"$1\" in\n"
    "  *[Uu]sername*) printf '%s' \"$AXIS_GIT_LOGIN\" ;;\n"
    "  *) printf '%s' \"$AXIS_GIT_TOKEN\" ;;\n"
    "esac\n";

// 호출마다 덮어써야 하는 환경변수.
// execve 는 중복 키를 허용하지 않으므로 상속받은 원본에서 먼저 제거한다.
const char *kOverriddenEnvKeys[] = {
    "GIT_CONFIG_NOSYSTEM", "GIT_CONFIG_SYSTEM", "GIT_CONFIG_GLOBAL",
    "GIT_TERMINAL_PROMPT", "GIT_ASKPASS", "GIT_ASKPASS_REQUIRE",
    "GIT_SSH_COMMAND", "SSH_ASKPASS", "GCM_INTERACTIVE",
    "AXIS_GIT_LOGIN", "AXIS_GIT_TOKEN"
};

// 커밋 그래프 로그의 출력 형식. 필드 순서가 곧 계약이다 - %H %P %an %ae %aI %D %s.
// 제목에 어떤 문자가 있어도 파싱이 깨지지 않도록 필드 구분자(US, 0x1f)·레코드 구분자(RS, 0x1e)를 쓴다.
const char *kLogPretty = "--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%D%x1f%s%x1e";

bool isOverriddenKey(const std::string &entry) {
    for (const char *key : kOverriddenEnvKeys) {
        const size_t len = std::strlen(key);
        if (entry.size() > len && entry.compare(0, len, key) == 0 && entry[len] == '=') {
            return true;
        }
    }
    return false;
}

std::string askpassPath() {
    std::error_code ec;
    std::filesystem::path dir = std::filesystem::temp_directory_path(ec);
    if (ec) {
        dir = "/tmp";
    }
    return (dir / "axis-share-git-askpass.sh").string();
}

// askpass 스크립트를 프로세스당 1회 준비한다. 실패하면 빈 문자열 (토큰 인증 불가).
std::string ensureAskpassScript() {
    static std::once_flag once;
    static std::string cached;

    std::call_once(once, []() {
        const std::string target = askpassPath();
        std::ofstream ofs(target, std::ios::binary | std::ios::trunc);
        if (!ofs) {
            LOG_ERROR << "askpass 스크립트를 생성할 수 없습니다: " << target;
            return;
        }
        ofs << kAskpassScript;
        ofs.flush();
        if (!ofs) {
            LOG_ERROR << "askpass 스크립트를 기록할 수 없습니다: " << target;
            return;
        }
        ::chmod(target.c_str(), S_IRWXU);  // 0700
        cached = target;
    });
    return cached;
}

void closeFd(int &fd) {
    if (fd >= 0) {
        ::close(fd);
        fd = -1;
    }
}

std::string joinCommand(const std::vector<std::string> &argv) {
    std::string s;
    for (const auto &a : argv) {
        if (!s.empty()) {
            s += ' ';
        }
        s += a;
    }
    return s;
}

std::string firstLine(const std::string &text) {
    const size_t pos = text.find('\n');
    return pos == std::string::npos ? text : text.substr(0, pos);
}

std::string sanitizeGitErrorText(const std::string &text, std::size_t maxLen) {
    std::string line = firstLine(text);
    const std::size_t cr = line.find('\r');
    if (cr != std::string::npos) {
        line.resize(cr);
    }

    std::string lower = line;
    for (char &ch : lower) {
        if (ch >= 'A' && ch <= 'Z') {
            ch = static_cast<char>(ch - 'A' + 'a');
        }
    }
    if (lower.find("authorization:") != std::string::npos ||
        lower.find("bearer ") != std::string::npos ||
        lower.find("x-access-token") != std::string::npos ||
        lower.find("token=") != std::string::npos ||
        lower.find("password=") != std::string::npos ||
        lower.find("secret=") != std::string::npos) {
        return "[redacted]";
    }

    for (char &ch : line) {
        const unsigned char value = static_cast<unsigned char>(ch);
        if (value < 0x20 || value == 0x7f) {
            ch = ' ';
        }
    }

    if (maxLen == 0) {
        return "";
    }
    if (line.size() > maxLen) {
        line.resize(maxLen);
        line += "...";
    }
    return line;
}

struct SpawnFileActions {
    posix_spawn_file_actions_t value{};
    int initRc = -1;

    SpawnFileActions() : initRc(::posix_spawn_file_actions_init(&value)) {}
    ~SpawnFileActions() {
        if (initRc == 0) {
            ::posix_spawn_file_actions_destroy(&value);
        }
    }
    SpawnFileActions(const SpawnFileActions &) = delete;
    SpawnFileActions &operator=(const SpawnFileActions &) = delete;
};

struct SpawnAttrs {
    posix_spawnattr_t value{};
    int initRc = -1;

    SpawnAttrs() : initRc(::posix_spawnattr_init(&value)) {}
    ~SpawnAttrs() {
        if (initRc == 0) {
            ::posix_spawnattr_destroy(&value);
        }
    }
    SpawnAttrs(const SpawnAttrs &) = delete;
    SpawnAttrs &operator=(const SpawnAttrs &) = delete;
};

// git 은 workDir 로 chdir 한 뒤 실행되므로, 인자로 넘긴 상대 경로는 repo 디렉터리 기준으로
// 해석된다. 예를 들어 worktree add 에 DB 의 상대 경로(repository/2/A.worktrees/x)를 그대로 넘기면
// 저장소 안쪽에 repository/2/A.worktrees/x 가 만들어져 버린다.
// git 에 넘기기 직전에 프로세스 CWD 기준 절대 경로로 바꿔, DB 값의 기준과 git 의 해석 기준을 맞춘다.
// (DB 에는 상대 경로를 그대로 둔다. main.cc 의 관리 경로 접두사 검사가 상대 경로를 전제로 한다.)
std::string absoluteFsPath(const std::string &path) {
    if (path.empty()) {
        return path;
    }
    std::error_code ec;
    const auto resolved = std::filesystem::absolute(path, ec);
    if (ec) {
        return path;
    }
    return resolved.lexically_normal().string();
}

}  // namespace

namespace app_utils {

bool GitRunner::isValidIdentity(const std::string &value) {
    if (value.empty()) {
        return false;
    }
    for (char ch : value) {
        if (ch == '\n' || ch == '\r' || ch == '<' || ch == '>') {
            return false;
        }
    }
    return true;
}

GitResult GitRunner::run(const std::string &workDir,
                         const std::vector<std::string> &args,
                         const Auth *auth,
                         int timeoutSec,
                         const std::vector<std::pair<std::string, std::string>> &extraEnv) {
    GitResult res;

    // 1. 하드닝 기본 인자를 앞에 붙인다 (저장소 훅 실행 금지, 서명 요구 제거, 서브모듈 재귀 금지)
    std::vector<std::string> full;
    full.reserve(args.size() + 9);
    full.push_back("git");
    full.push_back("-c");
    full.push_back("core.hooksPath=/dev/null");
    full.push_back("-c");
    full.push_back("commit.gpgsign=false");
    // 한글 등 비ASCII 경로를 8진수로 이스케이프하지 않는다 (경로가 그대로 JSON 으로 나간다)
    full.push_back("-c");
    full.push_back("core.quotepath=false");
    // 서브모듈을 재귀적으로 건드리지 않는다 — 저장소 안 .gitmodules 는 신뢰할 수 없는 입력이다
    full.push_back("-c");
    full.push_back("submodule.recurse=false");
    full.insert(full.end(), args.begin(), args.end());

    std::vector<char *> argv;
    argv.reserve(full.size() + 1);
    for (auto &a : full) {
        argv.push_back(const_cast<char *>(a.c_str()));
    }
    argv.push_back(nullptr);

    // 2. 자식 환경 구성 (시스템·전역 설정 무시, 대화형 프롬프트 차단)
    std::vector<std::string> envs;
    for (char **e = environ; e != nullptr && *e != nullptr; ++e) {
        std::string entry(*e);
        if (!isOverriddenKey(entry)) {
            envs.push_back(std::move(entry));
        }
    }
    envs.push_back("GIT_CONFIG_NOSYSTEM=1");
    envs.push_back("GIT_CONFIG_SYSTEM=/dev/null");
    envs.push_back("GIT_CONFIG_GLOBAL=/dev/null");
    envs.push_back("GIT_TERMINAL_PROMPT=0");
    envs.push_back("GCM_INTERACTIVE=never");

    const bool useAuth = (auth != nullptr && !auth->token.empty());
    if (useAuth) {
        const std::string askpass = ensureAskpassScript();
        if (!askpass.empty()) {
            envs.push_back("GIT_ASKPASS=" + askpass);
            envs.push_back("GIT_ASKPASS_REQUIRE=force");
            envs.push_back("AXIS_GIT_LOGIN=" + auth->login);
            envs.push_back("AXIS_GIT_TOKEN=" + auth->token);
        } else {
            LOG_WARN << "askpass 스크립트가 없어 토큰 인증을 사용할 수 없습니다";
        }
    }
    for (const auto &kv : extraEnv) {
        envs.push_back(kv.first + "=" + kv.second);
    }

    std::vector<char *> envp;
    envp.reserve(envs.size() + 1);
    for (auto &e : envs) {
        envp.push_back(const_cast<char *>(e.c_str()));
    }
    envp.push_back(nullptr);

    // 3. 출력 파이프 준비
    int outPipe[2] = {-1, -1};
    int errPipe[2] = {-1, -1};
    if (::pipe2(outPipe, O_CLOEXEC) != 0) {
        res.err = "pipe() 실패";
        return res;
    }
    if (::pipe2(errPipe, O_CLOEXEC) != 0) {
        closeFd(outPipe[0]);
        closeFd(outPipe[1]);
        res.err = "pipe() 실패";
        return res;
    }

    SpawnFileActions fileActions;
    SpawnAttrs attrs;
    int spawnErr = fileActions.initRc;

    if (spawnErr == 0) {
        spawnErr = ::posix_spawn_file_actions_addopen(
            &fileActions.value, STDIN_FILENO, "/dev/null", O_RDONLY, 0);
    }
    if (spawnErr == 0) {
        spawnErr = ::posix_spawn_file_actions_adddup2(
            &fileActions.value, outPipe[1], STDOUT_FILENO);
    }
    if (spawnErr == 0) {
        spawnErr = ::posix_spawn_file_actions_adddup2(
            &fileActions.value, errPipe[1], STDERR_FILENO);
    }
    if (spawnErr == 0 && !workDir.empty()) {
        spawnErr = ::posix_spawn_file_actions_addchdir_np(
            &fileActions.value, workDir.c_str());
    }
    if (spawnErr == 0) {
        spawnErr = attrs.initRc;
    }
    if (spawnErr == 0) {
        spawnErr = ::posix_spawnattr_setpgroup(&attrs.value, 0);
    }
    if (spawnErr == 0) {
        short flags = POSIX_SPAWN_SETPGROUP;
#ifdef POSIX_SPAWN_CLOEXEC_DEFAULT
        flags = static_cast<short>(flags | POSIX_SPAWN_CLOEXEC_DEFAULT);
#endif
        spawnErr = ::posix_spawnattr_setflags(&attrs.value, flags);
    }

    pid_t pid = -1;
    if (spawnErr == 0) {
        spawnErr = ::posix_spawnp(&pid, "git", &fileActions.value,
                                  &attrs.value, argv.data(), envp.data());
    }

    closeFd(outPipe[1]);
    closeFd(errPipe[1]);

    if (spawnErr != 0) {
        closeFd(outPipe[0]);
        closeFd(errPipe[0]);
        res.err = std::string("git 실행 실패: ") + std::strerror(spawnErr);
        return res;
    }

    const int limit = (timeoutSec > 0) ? timeoutSec : kDefaultTimeoutSec;
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(limit);
    bool killed = false;

    pollfd fds[2];
    fds[0].fd = outPipe[0];
    fds[0].events = POLLIN;
    fds[0].revents = 0;
    fds[1].fd = errPipe[0];
    fds[1].events = POLLIN;
    fds[1].revents = 0;
    int openCount = 2;

    // 시간 초과로 프로세스 그룹을 죽인 뒤에도 파이프 쓰기 끝이 남아 있을 수 있다.
    // (git 이 낳은 손자 프로세스가 상속한 경우) 무한히 poll 하지 않도록 정리 유예 시간을 둔다.
    const auto killGraceDeadline = deadline + std::chrono::milliseconds(500);

    while (openCount > 0) {
        const auto now = std::chrono::steady_clock::now();
        if (!killed && now >= deadline) {
            // 시간 초과: 프로세스 그룹째 종료하고, 남은 출력을 잠깐만 더 거둬들인다.
            ::kill(-pid, SIGKILL);
            ::kill(pid, SIGKILL);
            killed = true;
            res.timedOut = true;
        }
        if (killed && now >= killGraceDeadline) {
            break;
        }

        const auto pollDeadline = killed ? killGraceDeadline : deadline;
        auto remainMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                            pollDeadline - now)
                            .count();
        if (remainMs <= 0) {
            remainMs = 1;
        }

        const int n = ::poll(fds, 2, static_cast<int>(remainMs));
        if (n < 0) {
            if (errno == EINTR) {
                continue;
            }
            break;
        }

        for (int i = 0; i < 2; ++i) {
            if (fds[i].fd < 0) {
                continue;
            }
            if ((fds[i].revents & (POLLIN | POLLHUP | POLLERR)) == 0) {
                continue;
            }
            char buf[8192];
            const ssize_t r = ::read(fds[i].fd, buf, sizeof(buf));
            if (r > 0) {
                (i == 0 ? res.out : res.err).append(buf, static_cast<size_t>(r));
            } else if (r == 0 || errno != EINTR) {
                if (r < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) {
                    continue;
                }
                if (r < 0 && errno == EBADF) {
                    // 이미 유효하지 않은 fd 다. close 를 또 호출하면 그 사이 재사용된
                    // 다른 스레드의 fd 를 닫을 수 있으므로 소유권만 버린다.
                    fds[i].fd = -1;
                } else {
                    closeFd(fds[i].fd);
                }
                --openCount;
            }
        }
    }

    // 주의: 위 루프에서 이미 읽기 끝을 닫았다. outPipe[0]/errPipe[0] 는 fds[i].fd 의 복사본이라
    // 여기서 다시 닫으면 같은 fd 번호를 두 번 close 하게 된다. 그 사이 다른 스레드가 연 소켓이
    // 같은 번호를 받으면 그 소켓을 닫아버려 Drogon 이 EBADF/ epoll 단언으로 죽는다.
    // 소유권은 fds 배열 하나로만 관리한다 (이미 닫힌 fd 는 -1 이므로 중복 close 가 없다).
    closeFd(fds[0].fd);
    closeFd(fds[1].fd);

    int status = 0;
    pid_t waited = -1;
    do {
        waited = ::waitpid(pid, &status, 0);
    } while (waited < 0 && errno == EINTR);

    if (waited < 0) {
        res.exitCode = -1;
        if (res.err.empty()) {
            res.err = std::string("waitpid() 실패: ") + std::strerror(errno);
        }
    } else if (WIFEXITED(status)) {
        res.exitCode = WEXITSTATUS(status);
    } else if (WIFSIGNALED(status)) {
        res.exitCode = -1;
        const int sig = WTERMSIG(status);
        if (killed && sig == SIGKILL) {
            res.timedOut = true;
        }
    }

    // 4. 실패는 로그로 남긴다. 명령 인자에는 토큰이 들어가지 않으므로 그대로 찍어도 안전하다.
    if (!res.ok()) {
        LOG_WARN << "git 실패 (exit=" << res.exitCode
                 << (res.timedOut ? ", timeout" : "")
                 << (res.exitCode == 126 ? ", workdir 없음: " + workDir : "")
                 << (res.exitCode == 127 ? ", git 실행 파일 없음" : "")
                 << ") cmd=[" << joinCommand(full) << "] stderr="
                 << sanitizeGitErrorText(res.err, 512);
    }

    return res;
}

std::string GitRunner::safeError(const GitResult &result, std::size_t maxLen) {
    return sanitizeGitErrorText(result.err, maxLen);
}

GitResult GitRunner::clone(const std::string &parentDir, const std::string &url,
                           const std::string &destDir, const Auth *auth) {
    // parentDir 에서 실행하고 destDir 이름으로 clone 한다 (destDir 는 상대/절대 모두 가능)
    return run(parentDir, {"clone", "--quiet", url, destDir}, auth, 600);
}

GitResult GitRunner::lsRemote(const std::string &url, const Auth *auth) {
    // ref 광고만 받는다. clone 처럼 오브젝트를 내려받지 않으므로 접근 가능 여부만 싸게 본다.
    // HEAD 패턴으로 출력을 줄이고, --exit-code 는 쓰지 않는다(빈 저장소도 정상이므로).
    return run("", {"ls-remote", "--quiet", url, "HEAD"}, auth, 60);
}

GitResult GitRunner::fetchAll(const std::string &repoDir, const Auth *auth) {
    return run(repoDir, {"fetch", "--all", "--prune"}, auth, 300);
}

GitResult GitRunner::listRefs(const std::string &repoDir) {
    return run(repoDir, {"for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"});
}

GitResult GitRunner::lsTree(const std::string &repoDir, const std::string &ref, const std::string &path,
                         bool withSize) {
    // 디렉터리 단위 lazy 조회. path 가 비면 루트 한 단계만 나온다.
    // '<ref>:<path>' treeish 표기를 쓴다. git 은 첫 ':' 앞을 ref 로 해석하므로
    // 브랜치 이름에 '/' 가 있어도 (feature/x) 모호해지지 않는다.
    std::string clean = path;
    while (!clean.empty() && clean.front() == '/') {
        clean.erase(clean.begin());
    }
    while (!clean.empty() && clean.back() == '/') {
        clean.pop_back();
    }
    const std::string treeish = clean.empty() ? ref : (ref + ":" + clean);
    // -z 로 항목을 NUL 구분해 받는다. git 의 경로 인용(따옴표·8진수 이스케이프)이 사라져
    // 한글·공백·개행이 섞인 파일명도 그대로 쓸 수 있다.
    std::vector<std::string> args = {"ls-tree", "-z"};
    if (withSize) {
        args.push_back("-l");   // 파일 크기 (디렉터리는 '-')
    }
    args.push_back(treeish);
    return run(repoDir, args);
}

GitResult GitRunner::logWithParents(const std::string &repoDir, const std::string &ref, int limit) {
    // 커밋 그래프는 부모 SHA 가 있어야 레인을 배치할 수 있다.
    // --topo-order 는 브랜치별 커밋을 뭉쳐 두어 그래프가 세로로 흩어지지 않게 한다.
    return run(repoDir, {"log", "--topo-order", "-n", std::to_string(limit), kLogPretty, ref});
}

GitResult GitRunner::logAllWithParents(const std::string &repoDir, int limit) {
    // 저장소 전체 그래프. --all 은 로컬 브랜치·원격 추적 참조·태그를 모두 포함하므로,
    // 브랜치마다 로그를 따로 받아 클라이언트에서 합치는 일을 하지 않아도 된다.
    // 출력 형식은 logWithParents 와 같아 같은 파서를 쓴다 - ref 인자만 없다.
    return run(repoDir, {"log", "--all", "--topo-order", "-n", std::to_string(limit), kLogPretty});
}

GitResult GitRunner::lsFiles(const std::string &worktreeDir, std::vector<std::string> extraArgs) {
    // -z 로 경로를 NUL 구분해 받는다 (공백·개행이 있는 파일명 안전)
    std::vector<std::string> args = {"ls-files", "-z"};
    args.insert(args.end(), extraArgs.begin(), extraArgs.end());
    return run(worktreeDir, args);
}

GitResult GitRunner::status(const std::string &worktreeDir) {
    return run(worktreeDir, {"status", "--porcelain=v1", "--branch"});
}

GitResult GitRunner::currentBranch(const std::string &worktreeDir) {
    return run(worktreeDir, {"rev-parse", "--abbrev-ref", "HEAD"});
}

GitResult GitRunner::headSha(const std::string &worktreeDir) {
    return run(worktreeDir, {"rev-parse", "HEAD"});
}

GitResult GitRunner::revListCount(const std::string &repoDir, const std::string &range) {
    return run(repoDir, {"rev-list", "--count", range});
}

GitResult GitRunner::resolveRef(const std::string &repoDir, const std::string &ref) {
    return run(repoDir, {"rev-parse", "--verify", "--quiet", ref});
}

GitResult GitRunner::worktreeList(const std::string &repoDir) {
    return run(repoDir, {"worktree", "list", "--porcelain"});
}

GitResult GitRunner::worktreeAdd(const std::string &repoDir, const std::string &worktreeDir,
                                 const std::string &branch, const std::string &startPoint) {
    // 경로는 반드시 절대 경로로 넘긴다. 상대 경로면 repoDir 기준으로 해석되어 저장소 안쪽에
    // worktree 가 만들어지고, DB 의 worktree_path(프로세스 CWD 기준)와 어긋나 버린다.
    const std::string target = absoluteFsPath(worktreeDir);

    // 저장소 디렉터리 안쪽에 worktree 를 만들면 clone 의 작업 트리가 그 worktree 전체를
    // 추적되지 않은 파일로 보게 된다.
    // git 은 인자로 받은 상대 경로를 repoDir 기준으로 해석하므로, 과거처럼 상대 경로가 새어 들어오면
    // 여기서 막는다(위 absoluteFsPath 주석의 버그가 되살아나도 트리가 오염되지 않게).
    const std::string repoAbs = absoluteFsPath(repoDir);
    if (!repoAbs.empty() && target.size() > repoAbs.size() &&
        target.compare(0, repoAbs.size(), repoAbs) == 0 && target[repoAbs.size()] == '/') {
        GitResult rejected;
        rejected.exitCode = 1;
        rejected.err = "작업 디렉터리를 저장소 안쪽에 만들 수 없습니다: " + target;
        LOG_WARN << rejected.err;
        return rejected;
    }

    if (startPoint.empty()) {
        // 이미 있는 브랜치를 붙인다
        return run(repoDir, {"worktree", "add", target, branch});
    }
    // 기준 브랜치에서 새로 만든다
    return run(repoDir, {"worktree", "add", "-b", branch, target, startPoint});
}

GitResult GitRunner::worktreeRemove(const std::string &repoDir, const std::string &worktreeDir, bool force) {
    // worktreeAdd 와 같은 이유로 절대 경로를 넘긴다.
    std::vector<std::string> args = {"worktree", "remove"};
    if (force) {
        args.push_back("--force");
    }
    args.push_back(absoluteFsPath(worktreeDir));
    return run(repoDir, args);
}

GitResult GitRunner::deleteBranch(const std::string &repoDir, const std::string &branch, bool force) {
    return run(repoDir, {"branch", force ? "-D" : "-d", branch});
}

GitResult GitRunner::stageAdd(const std::string &worktreeDir, const std::vector<std::string> &paths) {
    if (paths.empty()) {
        GitResult r;
        r.err = "스테이징할 경로가 없습니다";
        return r;
    }
    std::vector<std::string> args = {"add", "--"};
    args.insert(args.end(), paths.begin(), paths.end());
    return run(worktreeDir, args);
}

GitResult GitRunner::stageRemove(const std::string &worktreeDir, const std::vector<std::string> &paths) {
    if (paths.empty()) {
        GitResult r;
        r.err = "스테이징 해제할 경로가 없습니다";
        return r;
    }
    std::vector<std::string> args = {"reset", "-q", "HEAD", "--"};
    args.insert(args.end(), paths.begin(), paths.end());
    return run(worktreeDir, args);
}

GitResult GitRunner::mv(const std::string &worktreeDir, const std::string &from, const std::string &to) {
    // 추적되는 경로는 git 으로 옮긴다. -f 는 "목적지가 있어도 덮어쓴다" 가 아니라
    // "수정된 파일이라도 옮긴다" 는 뜻이다(목적지 존재는 호출자가 미리 막는다).
    return run(worktreeDir, {"mv", "-f", "--", from, to});
}

GitResult GitRunner::rmPath(const std::string &worktreeDir, const std::string &path) {
    // -r 로 디렉터리까지, -f 로 수정·스테이징된 내용이 있어도 강제로 지운다.
    // 되돌릴 수 없으므로 확인은 호출자(API)가 받는다.
    return run(worktreeDir, {"rm", "-r", "-f", "-q", "--", path});
}

GitResult GitRunner::commit(const std::string &worktreeDir, const std::string &message,
                            const std::string &authorName, const std::string &authorEmail) {
    // 아이덴티티는 요청자를 검증한 값으로만 채운다
    if (!isValidIdentity(authorName) || !isValidIdentity(authorEmail)) {
        GitResult r;
        r.err = "커밋 아이덴티티가 유효하지 않습니다";
        return r;
    }
    if (message.empty()) {
        GitResult r;
        r.err = "커밋 메시지가 비어 있습니다";
        return r;
    }

    const std::vector<std::pair<std::string, std::string>> extra = {
        {"GIT_AUTHOR_NAME", authorName},
        {"GIT_AUTHOR_EMAIL", authorEmail},
        {"GIT_COMMITTER_NAME", authorName},
        {"GIT_COMMITTER_EMAIL", authorEmail},
    };
    return run(worktreeDir, {"commit", "--no-verify", "-m", message}, nullptr, kDefaultTimeoutSec, extra);
}

GitResult GitRunner::merge(const std::string &worktreeDir, const std::string &ref,
                           const std::string &authorName, const std::string &authorEmail) {
    if (ref.empty()) {
        GitResult r;
        r.err = "병합할 ref 가 비어 있습니다";
        return r;
    }
    if (!isValidIdentity(authorName) || !isValidIdentity(authorEmail)) {
        GitResult r;
        r.err = "병합 커밋 아이덴티티가 유효하지 않습니다";
        return r;
    }

    // merge commit 을 만들 때 서버 저장소에 사용자 설정이 없을 수 있다. 요청자 계정으로 고정한다.
    const std::vector<std::pair<std::string, std::string>> extra = {
        {"GIT_AUTHOR_NAME", authorName},
        {"GIT_AUTHOR_EMAIL", authorEmail},
        {"GIT_COMMITTER_NAME", authorName},
        {"GIT_COMMITTER_EMAIL", authorEmail},
    };
    return run(worktreeDir, {"merge", "--no-edit", ref}, nullptr, 300, extra);
}

GitResult GitRunner::reset(const std::string &worktreeDir, const std::string &mode, const std::string &ref) {
    if (mode != "soft" && mode != "mixed" && mode != "hard") {
        GitResult r;
        r.err = "reset mode 는 soft|mixed|hard 중 하나여야 합니다";
        return r;
    }
    if (ref.empty()) {
        GitResult r;
        r.err = "되돌릴 ref 가 비어 있습니다";
        return r;
    }
    return run(worktreeDir, {"reset", "--" + mode, ref}, nullptr, 120);
}

GitResult GitRunner::push(const std::string &worktreeDir, const std::string &branch, const Auth *auth) {
    // push 는 요청한 사용자의 토큰으로만 수행한다
    return run(worktreeDir, {"push", "origin", branch}, auth, 300);
}

}  // namespace app_utils
