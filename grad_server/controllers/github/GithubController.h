#pragma once

#include <drogon/HttpController.h>

using namespace drogon;

namespace api
{
// GitHub 저장소 연동 컨트롤러 (TASK_11).
// 저장소 연결/해제(+서버 로컬 clone), 디렉터리 트리 조회, 파일 내용, 브랜치 목록, 커밋 그래프,
// 사용자 PAT 자격증명 등록/조회/해제를 담당한다.
// 앱 → VSCode 확장 핸드오프 코드 발급과 확장 세션(토큰 교환·갱신)도 여기서 맡는다 (§3.4).
// 실시간 협업(/api/collab/*)과 제어 소켓(/api/github/ws)은 별도 컨트롤러가 맡는다.
class GithubController : public drogon::HttpController<GithubController>
{
  public:
    METHOD_LIST_BEGIN
    // --- 저장소 연결 / 목록 / 해제 (§3.2) ---
    ADD_METHOD_TO(GithubController::connectRepository,    "/api/github/repos", Post,   "JwtFilter");
    ADD_METHOD_TO(GithubController::getRepositories,      "/api/github/repos", Get,    "JwtFilter");
    ADD_METHOD_TO(GithubController::disconnectRepository, "/api/github/repos", Delete, "JwtFilter");

    // --- 서버 로컬 저장소 조회 ---
    ADD_METHOD_TO(GithubController::getRepositoryTree,    "/api/github/repos/tree",     Get, "JwtFilter");
    ADD_METHOD_TO(GithubController::getRepositoryFile,    "/api/github/repos/file",     Get, "JwtFilter");
    ADD_METHOD_TO(GithubController::getRepositoryCommits, "/api/github/repos/commits",  Get, "JwtFilter");
    ADD_METHOD_TO(GithubController::getBranches,          "/api/github/repos/branches", Get, "JwtFilter");
    ADD_METHOD_TO(GithubController::getPresence,          "/api/github/repos/presence", Get, "JwtFilter");

    // --- 브랜치 수명주기 (§1.3-5, §1.3-10) ---
    ADD_METHOD_TO(GithubController::createBranch,         "/api/github/repos/branches", Post,   "JwtFilter");
    ADD_METHOD_TO(GithubController::deleteBranch,         "/api/github/repos/branches", Delete, "JwtFilter");

    // --- 작업 트리: 커밋 직전 상태 확인 / 스테이징 / 수동 fetch (§1.3-8, §1.4) ---
    ADD_METHOD_TO(GithubController::getStatus,            "/api/github/repos/status",   Get,    "JwtFilter");
    ADD_METHOD_TO(GithubController::stagePaths,           "/api/github/repos/stage",    Post,   "JwtFilter");
    ADD_METHOD_TO(GithubController::unstagePaths,         "/api/github/repos/stage",    Delete, "JwtFilter");
    ADD_METHOD_TO(GithubController::discardPaths,         "/api/github/repos/discard",  Post,   "JwtFilter");
    ADD_METHOD_TO(GithubController::fetchRepository,      "/api/github/repos/fetch",    Post,   "JwtFilter");
    ADD_METHOD_TO(GithubController::getSync,              "/api/github/repos/sync",     Get,    "JwtFilter");

    // --- 커밋과 push 는 분리한다 (§1.3-7, §12.11) ---
    ADD_METHOD_TO(GithubController::commitPaths,          "/api/github/repos/commits",  Post,   "JwtFilter");
    ADD_METHOD_TO(GithubController::pushRepository,       "/api/github/repos/push",     Post,   "JwtFilter");

    // --- 사용자 GitHub 자격증명 (PAT) ---
    ADD_METHOD_TO(GithubController::getCredentialStatus,  "/api/github/credentials", Get,    "JwtFilter");
    ADD_METHOD_TO(GithubController::registerCredential,   "/api/github/credentials", Post,   "JwtFilter");
    ADD_METHOD_TO(GithubController::disconnectCredential, "/api/github/credentials", Delete, "JwtFilter");

    // --- 앱 → 확장 핸드오프 / 확장 세션 (§3.4, §12.1) ---
    ADD_METHOD_TO(GithubController::createHandoffCode,    "/api/github/handoff",            Post, "JwtFilter");
    // 아래 두 라우트는 확장이 아직 토큰을 받기 전에 호출하므로 JwtFilter 를 걸지 않는다.
    // 인증 대신 1회용 핸드오프 코드(P0811)와 리프레시 토큰(P0812)으로만 검증한다.
    ADD_METHOD_TO(GithubController::exchangeSession,      "/api/github/sessions",           Post);
    ADD_METHOD_TO(GithubController::refreshSession,       "/api/github/sessions/refresh",   Post);
    METHOD_LIST_END

    void connectRepository(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void getRepositories(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void disconnectRepository(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);

    void getRepositoryTree(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void getRepositoryFile(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void getRepositoryCommits(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void getBranches(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void getPresence(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);

    void createBranch(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void deleteBranch(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);

    void getStatus(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void stagePaths(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void unstagePaths(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void discardPaths(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void fetchRepository(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void getSync(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void commitPaths(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void pushRepository(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);

    void getCredentialStatus(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void registerCredential(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void disconnectCredential(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);

    void createHandoffCode(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void exchangeSession(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void refreshSession(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
};
}