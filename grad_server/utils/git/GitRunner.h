#pragma once

#include <string>
#include <utility>
#include <vector>

namespace app_utils {

// git 실행 결과
struct GitResult {
    int exitCode = -1;   // 종료 코드. 시그널 종료·타임아웃이면 -1
    bool timedOut = false;
    std::string out;     // 표준 출력
    std::string err;     // 표준 에러
    bool ok() const { return exitCode == 0 && !timedOut; }
};

// 저장소는 사용자가 가져온 외부 코드이므로 그 안의 git 설정을 신뢰하지 않는다.
// TASK_11 §5 하드닝 요구사항을 항상 강제한다.
//
//  - 인자를 argv 배열로 넘겨 셸을 거치지 않는다 (인자 주입 차단)
//  - 매 호출 앞에 -c core.hooksPath=/dev/null -c commit.gpgsign=false 를 붙인다
//  - GIT_CONFIG_NOSYSTEM=1, GIT_CONFIG_GLOBAL=/dev/null, GIT_TERMINAL_PROMPT=0
//  - 토큰은 argv 나 remote URL 에 넣지 않고 GIT_ASKPASS 로만 전달한다
//  - 호출마다 타임아웃을 걸고, 초과하면 프로세스 그룹째 종료한다
class GitRunner {
public:
    // 인증 정보. 없으면 nullptr 을 넘긴다
    struct Auth {
        std::string login;   // GitHub 아이디 (Username 프롬프트 응답)
        std::string token;   // PAT (Password 프롬프트 응답)
    };

    static constexpr int kDefaultTimeoutSec = 120;

    // git 하위 명령 실행. workDir 에서 chdir 한 뒤 실행한다
    static GitResult run(const std::string &workDir,
                         const std::vector<std::string> &args,
                         const Auth *auth = nullptr,
                         int timeoutSec = kDefaultTimeoutSec,
                         const std::vector<std::pair<std::string, std::string>> &extraEnv = {});

    // --- 자주 쓰는 명령 래퍼 (그 외는 run 으로 직접 조합한다) ---
    static GitResult clone(const std::string &parentDir, const std::string &url,
                           const std::string &destDir, const Auth *auth = nullptr);
    // clone 전에 원격 접근만 확인한다 (ref 광고만 받으므로 clone 보다 훨씬 싸다).
    // 없는 저장소·권한 없는 저장소에 대고 clone 을 시도하지 않기 위한 사전 점검용이다.
    static GitResult lsRemote(const std::string &url, const Auth *auth = nullptr);
    static GitResult fetchAll(const std::string &repoDir, const Auth *auth = nullptr);
    static GitResult listRefs(const std::string &repoDir);
    // withSize=true 면 ls-tree -l 로 파일 크기까지 받는다 (파일은 크기, 디렉터리는 '-')
    static GitResult lsTree(const std::string &repoDir, const std::string &ref, const std::string &path,
                         bool withSize = false);
    static GitResult lsFiles(const std::string &worktreeDir, std::vector<std::string> extraArgs = {});
    // 커밋 그래프용 로그. 부모 SHA 까지 있어야 레인을 배치할 수 있다.
    // 필드 구분자(US, 0x1f)·레코드 구분자(RS, 0x1e)로 받아 제목에 구분자가 있어도 안전하다.
    static GitResult logWithParents(const std::string &repoDir, const std::string &ref, int limit);
    static GitResult status(const std::string &worktreeDir);
    static GitResult worktreeList(const std::string &repoDir);
    // startPoint 가 비면 이미 있는 브랜치를 붙이고, 있으면 -b 로 새로 만든다
    static GitResult worktreeAdd(const std::string &repoDir, const std::string &worktreeDir,
                                 const std::string &branch, const std::string &startPoint = "");
    static GitResult worktreeRemove(const std::string &repoDir, const std::string &worktreeDir, bool force = false);
    static GitResult deleteBranch(const std::string &repoDir, const std::string &branch, bool force = false);
    static GitResult stageAdd(const std::string &worktreeDir, const std::vector<std::string> &paths);
    static GitResult stageRemove(const std::string &worktreeDir, const std::vector<std::string> &paths);
    static GitResult commit(const std::string &worktreeDir, const std::string &message,
                            const std::string &authorName, const std::string &authorEmail);
    static GitResult headSha(const std::string &worktreeDir);
    // range 의 커밋 수를 센다. push 대상(ahead)·뒤처진 커밋(behind) 계산에 쓴다.
    static GitResult revListCount(const std::string &repoDir, const std::string &range);
    // ref 를 SHA 로 확정한다. 없는 ref 는 exit 1 (--verify --quiet 로 조용히 실패).
    static GitResult resolveRef(const std::string &repoDir, const std::string &ref);
    static GitResult push(const std::string &worktreeDir, const std::string &branch, const Auth *auth);
    static GitResult currentBranch(const std::string &worktreeDir);

    // 커밋 아이덴티티 문자열 검증 (§5: 빈 값·CR/LF·'<'·'>' 거부로 로그 위조 방지)
    static bool isValidIdentity(const std::string &value);
};

}  // namespace app_utils