#pragma once

#include <drogon/WebSocketController.h>
#include <json/json.h>
#include <array>
#include <memory>
#include <shared_mutex>
#include <string>
#include <unordered_map>
#include <vector>

using namespace drogon;

namespace api
{
// 저장소·브랜치 단위 실시간 제어 소켓 (§3.3).
// 방 키는 repo:{repo_id}:branch:{branch} 이고, 같은 방의 접속자에게만 이벤트가 간다.
// 브랜치 생성·삭제처럼 저장소 전체에 알려야 하는 이벤트는 저장소 접두사로 한 번 더 훑는다.
class GithubWebSocketController : public drogon::WebSocketController<GithubWebSocketController>
{
  public:
    // 연결 수립 / 메시지 수신 / 연결 종료
    void handleNewConnection(const HttpRequestPtr &req, const WebSocketConnectionPtr &wsConnPtr) override;
    void handleNewMessage(const WebSocketConnectionPtr &wsConnPtr, std::string &&message, const WebSocketMessageType &type) override;
    void handleConnectionClosed(const WebSocketConnectionPtr &wsConnPtr) override;

    WS_PATH_LIST_BEGIN
    WS_PATH_ADD("/api/github/ws");
    WS_PATH_LIST_END

    // 같은 브랜치 방의 접속자에게 보낸다 (commit_started / commit_finished 등). 보낸 대상이 있으면 true.
    static bool broadcastToBranch(int repo_id, const std::string &branch, const Json::Value &event);

    // 같은 저장소의 모든 브랜치 접속자에게 보낸다 (branch_created / branch_deleted / presence_updated).
    static bool broadcastToRepository(int repo_id, const Json::Value &event);

  private:
    // 연결 1개당 유지하는 세션 상태. 인증 전에는 user_email 이 비어 있고 authenticated 가 false 다.
    struct WsSession {
        std::string user_email;
        std::string client_id;
        std::string connection_id;   // github_branch_presence.connection_id
        bool authenticated = false;
        int repo_id = 0;             // 들어가 있는 방(방에 없으면 0)
        std::string branch;
    };

    // 샤드 1개.
    //  - connections: 사용자별 목록. 같은 client_id 의 중복 소켓을 교체하는 데 쓴다.
    //  - rooms: 방별 목록. 브로드캐스트 대상이다.
    struct ConnectionShard {
        mutable std::shared_mutex mutex;
        std::unordered_map<std::string, std::vector<WebSocketConnectionPtr>> connections;
        std::unordered_map<std::string, std::vector<WebSocketConnectionPtr>> rooms;
    };

    // 32개의 샤드로 분할 관리
    static constexpr size_t SHARD_COUNT = 32;
    static std::array<ConnectionShard, SHARD_COUNT> shards_;

    // auth 프레임을 기다리는 최대 시간(초). 초과하면 연결을 닫는다.
    static constexpr double AUTH_DEADLINE_SECONDS = 10.0;

    // 키(사용자 이메일 또는 방 키)의 해시로 샤드를 O(1) 선택한다.
    static ConnectionShard &getShard(const std::string &key);

    // JWT Access Token 을 검증하고 user_email 을 돌려준다. 실패하면 빈 문자열.
    static std::string verifyAccessToken(const std::string &token);

    // 인증된 연결을 사용자 목록에 등록한다. 같은 client_id 의 기존 연결은 교체한다.
    static void registerConnection(const WebSocketConnectionPtr &wsConnPtr,
                                   const std::string &user_email,
                                   const std::string &client_id,
                                   const std::shared_ptr<WsSession> &session);
    static void unregisterConnection(const std::string &user_email, const WebSocketConnectionPtr &wsConnPtr);

    static void addToRoom(const std::string &room_key, const WebSocketConnectionPtr &wsConnPtr);
    static void removeFromRoom(const std::string &room_key, const WebSocketConnectionPtr &wsConnPtr);

    // 방 하나에 실제 전송한다. 끊긴 연결은 이때 회수한다(알림 소켓과 같은 copy-out 규칙).
    static bool sendToRoom(const std::string &room_key, const std::string &message);

    // 브랜치 방 입장(join / switch_branch 공통).
    // 접속자 행을 갱신하고 이전 방·새 방 양쪽에 목록 변경을 알린다.
    static void enterRoom(const WebSocketConnectionPtr &wsConnPtr,
                          const std::shared_ptr<WsSession> &session,
                          int repo_id,
                          const std::string &branch);

    // 접속자 행을 지우고 남은 접속자에게 알린다. 지울 행이 없으면 false.
    static bool removePresenceAndNotify(const std::shared_ptr<WsSession> &session);
};
}  // namespace api