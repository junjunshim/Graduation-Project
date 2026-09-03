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
    // 웹소켓 접근 경로 설정 (예: ws://localhost:8080/api/v1/notification/ws)
    WS_PATH_ADD("/api/v1/notification/ws");
    WS_PATH_LIST_END

    // 특정 유저의 모든 연결 세션으로 실시간 메시지를 발송하는 정적 함수
    static bool sendNotificationToUser(const std::string &user_email, const std::string &message);

  private:
    // 샤드 1개를 구성하는 구조체 (독립된 Mutex와 Multi-Connection Map)
    struct ConnectionShard {
        mutable std::shared_mutex mutex;
        std::unordered_map<std::string, std::vector<WebSocketConnectionPtr>> connections;
    };

    // 32개의 독립된 샤드로 분할 관리
    static constexpr size_t SHARD_COUNT = 32;
    static std::array<ConnectionShard, SHARD_COUNT> shards_;

    // 유저 이메일의 해시값을 통해 O(1)로 담당 샤드를 반환하는 헬퍼 함수
    static ConnectionShard& getShard(const std::string &user_email) {
        size_t index = std::hash<std::string>{}(user_email) % SHARD_COUNT;
        return shards_[index];
    }
};
}
