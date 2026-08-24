#pragma once

#include <drogon/WebSocketController.h>
#include <shared_mutex>
#include <unordered_map>
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

    // 특정 유저에게 실시간 메시지를 발송하는 정적 함수
    static bool sendNotificationToUser(const std::string &user_email, const std::string &message);

  private:
    // 유저 이메일과 웹소켓 연결 객체를 매핑하는 전역 관리용 스레드 안전 맵 구조
    static std::unordered_map<std::string, WebSocketConnectionPtr> userConnections_;
    static std::shared_mutex connectionsMutex_;
};
}
