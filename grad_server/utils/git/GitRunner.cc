#include "GitRunner.h"

#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <system_error>

#include <drogon/drogon.h>

#include <fcntl.h>
#include <poll.h>
#include <signal.h>
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
// (argv·remote URL·.git/config 어디에도 남기지 않기 위함 - §5).
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
    static std::string cached;
    static bool tried = false;
    if (tried) {
        return cached;
    }
    tried = true;

    const std::string target = askpassPath();
    {
        std::ofstream ofs(target, std::ios::binary | std::ios::trunc);
        if (!ofs) {
            LOG_ERROR << "askpass 스크립트를 생성할 수 없습니다: " << target;
            return cached;
        }
        ofs << kAskpassScript;
    }
    ::chmod(target.c_str(), S_IRWXU);  // 0700
    cached = target;
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

    // 1. 하드닝 기본 인자를 앞에 붙인다 (저장소 훅 실행 금지, 서명 요구 제거)
    std::vector<std::string> full;
    full.reserve(args.size() + 7);
    full.push_back("git");
    full.push_back("-c");
    full.push_back("core.hooksPath=/dev/null");
    full.push_back("-c");
    full.push_back("commit.gpgsign=false");
    // 한글 등 비ASCII 경로를 8진수로 이스케이프하지 않는다 (경로가 그대로 JSON 으로 나간다)
    full.push_back("-c");
    full.push_back("core.quotepath=false");
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
    if (::pipe(outPipe) != 0) {
        res.err = "pipe() 실패";
        return res;
    }
    if (::pipe(errPipe) != 0) {
        closeFd(outPipe[0]);
        closeFd(outPipe[1]);
        res.err = "pipe() 실패";
        return res;
    }

    const pid_t pid = ::fork();
    if (pid < 0) {
        closeFd(outPipe[0]);
        closeFd(outPipe[1]);
        closeFd(errPipe[0]);
        closeFd(errPipe[1]);
        res.err = "fork() 실패";
        return res;
    }

    if (pid == 0) {
        // --- 자식 프로세스 ---
        // 타임아웃 시 프로세스 그룹째 종료할 수 있도록 별도 그룹으로 분리한다
        ::setpgid(0, 0);

        if (!workDir.empty() && ::chdir(workDir.c_str()) != 0) {
            ::_exit(126);
        }

        const int devnull = ::open("/dev/null", O_RDONLY);
        if (devnull >= 0) {
            ::dup2(devnull, STDIN_FILENO);
            ::close(devnull);
        }
        ::dup2(outPipe[1], STDOUT_FILENO);
        ::dup2(errPipe[1], STDERR_FILENO);
        closeFd(outPipe[0]);
        closeFd(outPipe[1]);
        closeFd(errPipe[0]);
        closeFd(errPipe[1]);

        // 대화형 인증 프롬프트로 무한 대기하는 것을 막는 2차 방어선
        if (timeoutSec > 0) {
            ::alarm(static_cast<unsigned int>(timeoutSec));
        }

        // 반드시 execvpe(envp) 로 실행한다. execvp 는 위에서 구성한 envp 를 버리고 부모의
        // environ 을 그대로 쓰기 때문에 GIT_TERMINAL_PROMPT=0 · GIT_ASKPASS 가 적용되지 않아
        // git 이 아이디/비밀번호를 대화형으로 물어보며 멈춘다.
        ::execvpe("git", argv.data(), envp.data());
        ::_exit(127);  // exec 실패
    }

    // --- 부모 프로세스 ---
    // setpgid 경합을 막기 위해 부모도 시도한다 (자식이 이미 했으면 실패해도 무해)
    ::setpgid(pid, pid);
    closeFd(outPipe[1]);
    closeFd(errPipe[1]);

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

    while (openCount > 0) {
        auto remainMs = std::chrono::duration_cast<std::chrono::milliseconds>(
                            deadline - std::chrono::steady_clock::now())
                            .count();
        if (remainMs <= 0) {
            // 시간 초과: 남은 출력을 거둬들이기 위해 짧게만 더 기다린다
            if (!killed) {
                ::kill(-pid, SIGKILL);
                ::kill(pid, SIGKILL);
                killed = true;
                res.timedOut = true;
            }
            remainMs = 200;
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
                closeFd(fds[i].fd);
                --openCount;
            }
        }
    }

    closeFd(outPipe[0]);
    closeFd(errPipe[0]);

    int status = 0;
    while (::waitpid(pid, &status, 0) < 0 && errno == EINTR) {
        // 시그널로 중단되면 재시도
    }

    if (WIFEXITED(status)) {
        res.exitCode = WEXITSTATUS(status);
    } else if (WIFSIGNALED(status)) {
        res.exitCode = -1;
        const int sig = WTERMSIG(status);
        if (sig == SIGALRM || (killed && sig == SIGKILL)) {
            res.timedOut = true;
        }
    }

    // 4. 실패는 로그로 남긴다. 명령 인자에는 토큰이 들어가지 않으므로 그대로 찍어도 안전하다.
    if (!res.ok()) {
        LOG_WARN << "git 실패 (exit=" << res.exitCode
                 << (res.timedOut ? ", timeout" : "")
                 << (res.exitCode == 126 ? ", workdir 없음: " + workDir : "")
                 << (res.exitCode == 127 ? ", git 실행 파일 없음" : "")
                 << ") cmd=[" << joinCommand(full) << "] stderr=" << firstLine(res.err);
    }

    return res;
}

GitResult GitRunner::clone(const std::string &parentDir, const std::string &url,
                           const std::string &destDir, const Auth *auth) {
    // parentDir 에서 실행하고 destDir 이름으로 clone 한다 (destDir 는 상대/절대 모두 가능)
    return run(parentDir, {"clone", "--quiet", url, destDir}, auth, 600);
}

GitResult GitRunner::fetchAll(const std::string &repoDir, const Auth *auth) {
    return run(repoDir, {"fetch", "--all", "--prune"}, auth, 300);
}

GitResult GitRunner::listRefs(const std::string &repoDir) {
    return run(repoDir, {"for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes"});
}

GitResult GitRunner::lsTree(const std::string &repoDir, const std::string &ref, const std::string &path,
                         bool withSize) {
    // 디렉터리 단위 lazy 조회 (§12.3). path 가 비면 루트 한 단계만 나온다.
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

GitResult GitRunner::worktreeList(const std::string &repoDir) {
    return run(repoDir, {"worktree", "list", "--porcelain"});
}

GitResult GitRunner::worktreeAdd(const std::string &repoDir, const std::string &worktreeDir,
                                 const std::string &branch, const std::string &startPoint) {
    if (startPoint.empty()) {
        // 이미 있는 브랜치를 붙인다
        return run(repoDir, {"worktree", "add", worktreeDir, branch});
    }
    // 기준 브랜치에서 새로 만든다
    return run(repoDir, {"worktree", "add", "-b", branch, worktreeDir, startPoint});
}

GitResult GitRunner::worktreeRemove(const std::string &repoDir, const std::string &worktreeDir, bool force) {
    std::vector<std::string> args = {"worktree", "remove"};
    if (force) {
        args.push_back("--force");
    }
    args.push_back(worktreeDir);
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

GitResult GitRunner::commit(const std::string &worktreeDir, const std::string &message,
                            const std::string &authorName, const std::string &authorEmail) {
    // 아이덴티티는 요청자를 검증한 값으로만 채운다 (§2.4: 요청 body 를 신뢰하지 않는다)
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

GitResult GitRunner::push(const std::string &worktreeDir, const std::string &branch, const Auth *auth) {
    // push 는 요청한 사용자의 토큰으로만 수행한다 (§6-4)
    return run(worktreeDir, {"push", "origin", branch}, auth, 300);
}

}  // namespace app_utils
