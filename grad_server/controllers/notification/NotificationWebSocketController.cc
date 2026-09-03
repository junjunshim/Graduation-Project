#include "NotificationWebSocketController.h"
#include <jwt-cpp/jwt.h>
#include <json/json.h>
#include <algorithm>

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

    // 3. 해당 유저의 담당 샤드에 스레드 안전하게 새 커넥션 추가 (다중 기기 동시 지원)
    auto &shard = getShard(user_email);
    {
        std::unique_lock<std::shared_mutex> lock(shard.mutex);
        shard.connections[user_email].push_back(wsConnPtr);
    }

    // 4. 소켓 커넥션 객체에 유저 정보를 컨텍스트로 바인딩 (연결 종료 시 식별용)
    wsConnPtr->setContext(std::make_shared<std::string>(user_email));
    
    LOG_INFO << "WebSocket connected: " << user_email << " (Active sessions on shard: " << shard.connections[user_email].size() << ")";

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
        // 해당 유저의 샤드에서 닫힌 특정 커넥션 포인터만 선택 제거
        auto &shard = getShard(user_email);
        {
            std::unique_lock<std::shared_mutex> lock(shard.mutex);
            auto it = shard.connections.find(user_email);
            if (it != shard.connections.end())
            {
                auto &vec = it->second;
                vec.erase(
                    std::remove_if(vec.begin(), vec.end(),
                        [&wsConnPtr](const WebSocketConnectionPtr &conn) {
                            return conn == wsConnPtr || !conn || conn->disconnected();
                        }),
                    vec.end()
                );

                if (vec.empty())
                {
                    shard.connections.erase(it);
                }
            }
        }
        LOG_INFO << "WebSocket disconnected: " << user_email;
    }
}

bool NotificationWebSocketController::sendNotificationToUser(const std::string &user_email, const std::string &message)
{
    std::vector<WebSocketConnectionPtr> targetConnections;

    // 1. 해당 샤드에서 Read Lock을 아주 잠깐만 걸고 해당 유저의 모든 활성 소켓 포인터 복사(Copy-out)
    auto &shard = getShard(user_email);
    {
        std::shared_lock<std::shared_mutex> lock(shard.mutex);
        auto it = shard.connections.find(user_email);
        if (it != shard.connections.end())
        {
            for (const auto &conn : it->second)
            {
                if (conn && conn->connected())
                {
                    targetConnections.push_back(conn);
                }
            }
        }
    } // 🔓 락 즉시 해제

    // 2. 락이 완전히 해제된 상태에서 각 연결 기기(Desktop 앱, VSCode 등)로 실제 네트워크 I/O 동시 전송
    if (!targetConnections.empty())
    {
        for (const auto &conn : targetConnections)
        {
            conn->send(message);
        }
        return true;
    }

    return false; // 대상이 오프라인 상태임
}
