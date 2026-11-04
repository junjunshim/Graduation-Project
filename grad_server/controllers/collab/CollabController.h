#pragma once

#include <drogon/HttpController.h>

using namespace drogon;

namespace api
{
// 협업(collab) 사이드카 연동 컨트롤러. 확장은 POST /api/collab/tickets 로 1회용 티켓(TTL 60초)을 받아
// wss://<host>/collab/?ticket=<t> 로 문서 소켓에 붙는다(문서 소켓은 collab 컨테이너가 담당한다).
// 이 컨트롤러는 인증·권한·티켓만 다룬다 — Yjs 텍스트 병합과 worktree 파일 flush 는 collab(Node.js)이
// 맡으므로 여기에 git·파일 로직이 없다. /internal/* 은 외부에 노출하지 않는다(nginx 차단 + INTERNAL_TOKEN).
class CollabController : public drogon::HttpController<CollabController>
{
  public:
    METHOD_LIST_BEGIN
    // 확장 → C++: 협업 티켓 발급 (repo 단위, 브랜치는 담지 않는다)
    ADD_METHOD_TO(CollabController::issueTicket, "/api/collab/tickets", Post, "JwtFilter");

    // collab → C++: 내부 전용. JwtFilter 를 걸지 않고 INTERNAL_TOKEN 헤더로 검증한다.
    ADD_METHOD_TO(CollabController::consumeTicket, "/internal/collab/tickets/consume", Post);
    // worktree 경로의 진실은 DB(github_branches.worktree_path)에 있고 그 값을 아는 것은 C++ 뿐이라,
    // collab 은 여기서 받은 볼륨 상대 경로만 보고 파일을 읽고 쓴다.
    ADD_METHOD_TO(CollabController::resolvePath, "/internal/collab/resolve", Post);
    // collab 이 파일을 내려쓴 직후 부른다. C++ 은 같은 브랜치 방에 worktree_changed 를 중계한다.
    ADD_METHOD_TO(CollabController::notifyWorktreeChanged, "/internal/collab/worktree-changed", Post);
    // collab 이 자기 세션 목록(사용자 × 저장소)을 들고 주기적으로 물어본다. 권한 변경 통보가 유실된
    // 경우(우회 클라이언트·일시 오류)의 안전망이다 — 판정은 DB 함수가 한다.
    ADD_METHOD_TO(CollabController::recheckPermissions, "/internal/collab/permissions/recheck", Post);
    METHOD_LIST_END

    void issueTicket(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void consumeTicket(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void resolvePath(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void notifyWorktreeChanged(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void recheckPermissions(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
};
}
