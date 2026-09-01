#include "NotificationWebSocketController.h"
#include <jwt-cpp/jwt.h>
#include <json/json.h>

using namespace api;

// 정적 샤드 배열 초기화
std::array<NotificationWebSocketController::ConnectionShard, NotificationWebSocketController::SHARD_COUNT> NotificationWebSocketController::shards_;

void NotificationWebSocketController::handleNewConnection(const HttpRequestPtr &req, const WebSocketConnectionPtr &wsConnPtr)
{
    // 1. 쿼리 파라미터에서 JWT access_token 획득
    auto token = req->getParameter("token");
    if (token.empty())
    {
        LOG_WARN << "WebSocket handshake failed: Token is missing.";
        wsConnPtr->forceClose();
        return;
    }

    // 2. JWT 토큰 검증 및 유저 이메일 획득
    auto secret = drogon::app().getCustomConfig()["app"]["jwt_secret"].asString();
    std::string user_email;
    try
    {
        auto verifier = jwt::verify()
            .allow_algorithm(jwt::algorithm::hs256{secret})
            .with_issuer("grad_server");

        auto decoded = jwt::decode(token);
        verifier.verify(decoded);

        user_email = decoded.get_payload_claim("user_email").as_string();
    }
    catch (const std::exception &e)
    {
        LOG_WARN << "WebSocket handshake failed: Invalid or expired token. Reason: " << e.what();
        wsConnPtr->forceClose();
        return;
    }

    // 3. 해당 유저의 담당 샤드에만 스레드 안전하게 세션 추가
    auto &shard = getShard(user_email);
    {
        std::unique_lock<std::shared_mutex> lock(shard.mutex);
        shard.connections[user_email] = wsConnPtr;
    }

    // 4. 소켓 커넥션 객체에 유저 정보를 컨텍스트로 바인딩 (연결 종료 시 식별용)
    wsConnPtr->setContext(std::make_shared<std::string>(user_email));
    
    LOG_INFO << "WebSocket connected: " << user_email;

    // 연결 성공 웰컴 메시지 발송
    Json::Value welcome;
    welcome["type"] = "SYSTEM";
    welcome["message"] = "Connected to real-time notification service.";
    
    Json::StreamWriterBuilder writer;
    wsConnPtr->send(Json::writeString(writer, welcome));
}

void NotificationWebSocketController::handleNewMessage(const WebSocketConnectionPtr &wsConnPtr, std::string &&message, const WebSocketMessageType &type)
{
    // 나중에 VSCode 실시간 코드 편집 공유 등 양방향 메시지가 올 때 처리할 슬롯입니다.
    // 일단 지금은 수신 메시지를 단순히 에코하거나 디버그 로그로 남깁니다.
    auto user_email = wsConnPtr->getContext<std::string>();
    LOG_DEBUG << "WebSocket message from " << (user_email ? *user_email : "unknown") << ": " << message;
}

void NotificationWebSocketController::handleConnectionClosed(const WebSocketConnectionPtr &wsConnPtr)
{
    // 소켓 컨텍스트에서 바인딩된 유저 이메일 추출
    auto user_email_ptr = wsConnPtr->getContext<std::string>();
    if (user_email_ptr)
    {
        std::string user_email = *user_email_ptr;
        // 해당 유저의 샤드에서 스레드 안전하게 세션 삭제
        auto &shard = getShard(user_email);
        {
            std::unique_lock<std::shared_mutex> lock(shard.mutex);
            shard.connections.erase(user_email);
        }
        LOG_INFO << "WebSocket disconnected: " << user_email;
    }
}

bool NotificationWebSocketController::sendNotificationToUser(const std::string &user_email, const std::string &message)
{
    WebSocketConnectionPtr targetConn = nullptr;

    // 1. 해당 샤드에서 Read Lock을 아주 잠깐만 걸고 소켓 스마트 포인터만 복사(Copy-out)
    auto &shard = getShard(user_email);
    {
        std::shared_lock<std::shared_mutex> lock(shard.mutex);
        auto it = shard.connections.find(user_email);
        if (it != shard.connections.end())
        {
            targetConn = it->second;
        }
    } // 🔓 락 즉시 해제

    // 2. 락이 완전히 해제된 상태에서 실제 네트워크 I/O 전송
    if (targetConn)
    {
        targetConn->send(message);
        return true;
    }
    return false; // 대상이 오프라인 상태임
}
