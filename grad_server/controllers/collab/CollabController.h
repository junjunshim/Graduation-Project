#pragma once

#include <drogon/HttpController.h>

using namespace drogon;

namespace api
{
// 협업(collab) 사이드카 연동 컨트롤러 (TASK_11 §3.2 / §9.2).
//
// 흐름:
//   [확장] POST /api/collab/tickets            (JWT 필요) → 1회용 티켓(TTL 60초)
//   [확장] wss://<host>/collab/?ticket=<t>     (문서 소켓, collab 컨테이너가 담당)
//   [collab] POST /internal/collab/tickets/consume (INTERNAL_TOKEN) → 세션 정보
//   [collab] POST /internal/collab/resolve          (INTERNAL_TOKEN) → 브랜치 작업 디렉터리
//
// 이 컨트롤러는 "인증·권한·티켓"만 다룬다. Yjs 텍스트 병합과 worktree 파일 flush 는
// collab(Node.js)이 담당하므로 여기에는 git·파일 로직이 없다.
// /internal/* 은 외부에 노출하지 않는다(nginx 에서 차단, INTERNAL_TOKEN 로 이중 보호).
class CollabController : public drogon::HttpController<CollabController>
{
  public:
    METHOD_LIST_BEGIN
    // 확장 → C++: 협업 티켓 발급 (repo 단위, 브랜치는 담지 않는다)
    ADD_METHOD_TO(CollabController::issueTicket, "/api/collab/tickets", Post, "JwtFilter");
    // collab → C++: 티켓 소비 (내부 전용 — JwtFilter 를 걸지 않고 INTERNAL_TOKEN 헤더로 검증)
    ADD_METHOD_TO(CollabController::consumeTicket, "/internal/collab/tickets/consume", Post);
    // collab → C++: 브랜치 작업 디렉터리 해석 (내부 전용).
    //   worktree 경로의 진실은 DB(github_branches.worktree_path)에 있고, 그 값을 아는 것은 C++ 뿐이다.
    //   collab 은 여기서 받은 볼륨 상대 경로만 보고 파일을 읽고 쓴다.
    ADD_METHOD_TO(CollabController::resolvePath, "/internal/collab/resolve", Post);
    // collab → C++: worktree 파일 flush 알림 (내부 전용, §9.9).
    //   collab 이 파일을 내려쓴 직후 부른다. C++ 은 같은 브랜치 방에 worktree_changed 를 중계한다.
    ADD_METHOD_TO(CollabController::notifyWorktreeChanged, "/internal/collab/worktree-changed", Post);
    METHOD_LIST_END

    void issueTicket(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void consumeTicket(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void resolvePath(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void notifyWorktreeChanged(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
};
}