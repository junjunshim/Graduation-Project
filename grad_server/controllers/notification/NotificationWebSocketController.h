#pragma once

#include <drogon/WebSocketController.h>
#include <shared_mutex>
#include <mutex>
#include <unordered_map>
#include <vector>
#include <array>
#include <string>

using namespace drogon;

namespace api
{
class NotificationWebSocketController : public drogon::WebSocketController<NotificationWebSocketController>
{
  public:
    // 웹소켓 연결, 메시지 수신, 연결 종료 이벤트 핸들러 오버라이드
    void handleNewConnection(const HttpRequestPtr &req, const WebSocketConnectionPtr &wsConnPtr) override;
    void handleNewMessage(const WebSocketConnectionPtr &wsConnPtr, std::string &&message, const WebSocketMessageType &type) override;
    void handleConnectionClosed(const WebSocketConnectionPtr &wsConnPtr) override;

    WS_PATH_LIST_BEGIN
    // 웹소켓 접근 경로 설정 (예: ws://localhost:8080/api/notification/ws)
    WS_PATH_ADD("/api/notification/ws");
    WS_PATH_LIST_END

    // 특정 유저의 모든 연결 세션으로 실시간 메시지를 발송하는 정적 함수
    static bool sendNotificationToUser(const std::string &user_email, const std::string &message);

    // PostgreSQL LISTEN/NOTIFY 수신 백그라운드 리스너 시작 함수
    static void startNotificationListener(const std::string &conninfo);

  private:
    // 연결 1개당 유지하는 세션 상태. 인증 전에는 user_email 이 비어 있고 authenticated 가 false 다.
    struct WsSession {
        std::string user_email;
        std::string client_id;
        bool authenticated = false;
        mutable std::mutex presence_mutex; // 현재 채널 상태(channel_id) 보호
        int channel_id = 0;          // 현재 보고 있는 채널(없으면 0)
    };

    // 샤드 1개를 구성하는 구조체 (읽기/쓰기 Mutex 와 Multi-Connection Map)
    struct ConnectionShard {
        mutable std::shared_mutex mutex;
        std::unordered_map<std::string, std::vector<WebSocketConnectionPtr>> connections;
        std::unordered_map<std::string, std::vector<WebSocketConnectionPtr>> rooms;
    };

    // 32개의 샤드로 분할 관리
    static constexpr size_t SHARD_COUNT = 32;
    static std::array<ConnectionShard, SHARD_COUNT> shards_;

    // AUTH 프레임을 기다리는 최대 시간(초). 초과하면 연결을 닫는다.
    static constexpr double AUTH_DEADLINE_SECONDS = 10.0;

    // 유저 이메일의 해시값을 통해 O(1)로 해당 샤드를 반환하는 헬퍼 함수
    static ConnectionShard& getShard(const std::string &user_email) {
        size_t index = std::hash<std::string>{}(user_email) % SHARD_COUNT;
        return shards_[index];
    }

    // JWT Access Token 을 검증하고 user_email 을 반환한다. 검증에 실패하면 빈 문자열.
    static std::string verifyAccessToken(const std::string &token);

    // 인증된 연결을 샤드에 등록한다. 같은 client_id 의 기존 연결은 교체한다.
    // 사용자가 오프라인 -> 온라인으로 바뀌었으면 true 를 반환한다.
    static bool registerConnection(const WebSocketConnectionPtr &wsConnPtr,
                                   const std::string &user_email,
                                   const std::string &client_id,
                                   const std::shared_ptr<WsSession> &session);

    // 채널 참여자(presence) 방 관리. 방 키는 channel:{channel_id} 이다.
    static std::string channelRoomKey(int channel_id);
    static void addToRoom(const std::string &room_key, const WebSocketConnectionPtr &wsConnPtr);
    static void removeFromRoom(const std::string &room_key, const WebSocketConnectionPtr &wsConnPtr);
    static bool sendToRoom(const std::string &room_key, const std::string &message);

    // 채널 방 입장/퇴장. 입장한 연결에는 채널 사용자 현황 스냅샷을 보낸다.
    // 사용자 목록 자체는 채널 권한에서 나오므로 방 입장/퇴장으로 목록이 바뀌지 않는다.
    static void enterChannelRoom(const WebSocketConnectionPtr &wsConnPtr,
                                 const std::shared_ptr<WsSession> &session,
                                 int channel_id);
    static bool leaveChannelRoom(const WebSocketConnectionPtr &wsConnPtr,
                                 const std::shared_ptr<WsSession> &session);

    // 채널을 볼 수 있는 사용자 전체 목록에 전역 접속 상태(online)를 붙여 같은 방에 보낸다.
    static void broadcastChannelPresence(int channel_id);

    // 사용자 인증 연결 수가 0 <-> 1 로 바뀌면 열려 있는 모든 채널 방의 접속 상태를 갱신한다.
    static void broadcastPresenceToAllRooms();

    // 해당 이메일로 인증된 WebSocket 연결이 하나 이상 살아 있는지 확인한다.
    static bool isUserOnline(const std::string &user_email);

    // 채널 하나의 presence 이벤트를 만들어 지정한 연결로 보낸다.
    static bool sendChannelPresence(const WebSocketConnectionPtr &wsConnPtr, int channel_id);

    // SQL 에서 채널 사용자 목록을 읽어 CHANNEL_PRESENCE 이벤트 JSON 을 만든다.
    static bool buildChannelPresenceMessage(int channel_id, std::string &message);
};
}
