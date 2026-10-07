#pragma once

#include <drogon/HttpController.h>

using namespace drogon;

namespace api
{
// GitHub 저장소 연동 컨트롤러 (TASK_11).
// 저장소 연결/해제(+서버 로컬 clone), 디렉터리 트리 조회, 파일 내용, 브랜치 목록,
// 사용자 PAT 자격증명 등록/조회/해제를 담당한다.
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
    ADD_METHOD_TO(GithubController::getBranches,          "/api/github/repos/branches", Get, "JwtFilter");

    // --- 사용자 GitHub 자격증명 (PAT) ---
    ADD_METHOD_TO(GithubController::getCredentialStatus,  "/api/github/credentials", Get,    "JwtFilter");
    ADD_METHOD_TO(GithubController::registerCredential,   "/api/github/credentials", Post,   "JwtFilter");
    ADD_METHOD_TO(GithubController::disconnectCredential, "/api/github/credentials", Delete, "JwtFilter");
    METHOD_LIST_END

    void connectRepository(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void getRepositories(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void disconnectRepository(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);

    void getRepositoryTree(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void getRepositoryFile(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void getBranches(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);

    void getCredentialStatus(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void registerCredential(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void disconnectCredential(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
};
}