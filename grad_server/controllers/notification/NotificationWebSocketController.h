#pragma once

#include <drogon/WebSocketController.h>
#include <shared_mutex>
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
    };

    // 샤드 1개를 구성하는 구조체 (읽기/쓰기 Mutex 와 Multi-Connection Map)
    struct ConnectionShard {
        mutable std::shared_mutex mutex;
        std::unordered_map<std::string, std::vector<WebSocketConnectionPtr>> connections;
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
    static void registerConnection(const WebSocketConnectionPtr &wsConnPtr,
                                   const std::string &user_email,
                                   const std::string &client_id,
                                   const std::shared_ptr<WsSession> &session);
};
}
