#include "NotificationWebSocketController.h"
#include <jwt-cpp/jwt.h>
#include <json/json.h>
#include <algorithm>
#include <thread>
#include <chrono>
#include <cstring>
#include <fstream>
#include <libpq-fe.h>
#ifndef _WIN32
#include <sys/select.h>
#endif

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

// 활동 알림 JSON을 수신자별 맞춤(업무 열람 권한 유무에 따른 마스킹)으로 생성하여 샤딩 락 분리를 통해 전송
static void processActivityNotification(const std::string &rawPayload)
{
    Json::Reader reader;
    Json::Value root;
    if (!reader.parse(rawPayload, root))
    {
        LOG_ERROR << "[NotificationListener] Failed to parse activity payload: " << rawPayload;
        return;
    }

    if (!root.isMember("recipients") || !root["recipients"].isArray() || root["recipients"].empty())
    {
        return;
    }

    int activityId = root["activity_id"].asInt();
    int nodeId = root["node_id"].asInt();
    std::string actorUserId = root["actor_user_id"].asString();
    std::string actorName = root["actor_name"].asString();
    std::string entityType = root["entity_type"].asString();
    std::string entityId = root["entity_id"].asString();
    std::string targetName = root["target_name"].asString();
    std::string actionType = root["action_type"].asString();
    std::string createdAt = root["created_at"].asString();

    // 알림 제목 및 기본 내용 생성
    std::string title;
    std::string actionKorean = "수정했습니다.";
    if (actionType == "inserted") actionKorean = "생성했습니다.";
    else if (actionType == "deleted") actionKorean = "삭제했습니다.";
    else if (actionType == "restored") actionKorean = "복구했습니다.";

    if (entityType == "WORK_ITEM") title = "업무 알림";
    else if (entityType == "NODE") title = "노드 알림";
    else if (entityType == "ROLE" || entityType == "AUTHORITY") title = "권한/역할 알림";
    else if (entityType == "FILE") title = "파일 알림";
    else if (entityType == "COMMENT") title = "댓글 알림";
    else title = "활동 알림";

    std::string linkUrl;
    if (entityType == "WORK_ITEM") linkUrl = "/work-items/" + entityId;
    else if (entityType == "NODE") linkUrl = "/workspaces/" + std::to_string(nodeId);
    else linkUrl = "/workspaces/" + std::to_string(nodeId) + "?tab=timeline";

    // 1. 업무 상세 조회 권한이 있는 사용자용 페이로드 직렬화
    Json::Value fullPayload;
    fullPayload["type"] = "NOTIFICATION";
    fullPayload["sub_type"] = "ACTIVITY";
    fullPayload["data"]["notification_id"] = activityId;
    fullPayload["data"]["node_id"] = nodeId;
    fullPayload["data"]["entity_type"] = entityType;
    fullPayload["data"]["entity_id"] = entityId;
    fullPayload["data"]["action"] = actionType;
    fullPayload["data"]["actor_user_id"] = actorUserId;
    fullPayload["data"]["actor_name"] = actorName;
    fullPayload["data"]["title"] = title;
    fullPayload["data"]["content"] = actorName + "님이 '" + targetName + "'을(를) " + actionKorean;
    fullPayload["data"]["link_url"] = linkUrl;
    fullPayload["data"]["is_read"] = false;
    fullPayload["data"]["created_at"] = createdAt;
    fullPayload["data"]["can_view_detail"] = true;

    // 2. 업무 상세 조회 권한이 없는(마스킹된) 사용자용 페이로드 직렬화
    Json::Value maskedPayload = fullPayload;
    if (entityType == "WORK_ITEM") {
        maskedPayload["data"]["content"] = actorName + "님이 업무[" + entityId + "]를 " + actionKorean;
        maskedPayload["data"]["link_url"] = "/workspaces/" + std::to_string(nodeId) + "?tab=timeline";
    }
    maskedPayload["data"]["can_view_detail"] = false;

    Json::StreamWriterBuilder writer;
    std::string fullMsg = Json::writeString(writer, fullPayload);
    std::string maskedMsg = Json::writeString(writer, maskedPayload);

    // 3. 수신자 목록을 순회하며 각 유저에게 샤딩 락 격리 방식으로 발송 (중첩 락 없음)
    for (const auto &recipient : root["recipients"])
    {
        std::string email = recipient["email"].asString();
        bool canView = recipient["can_view_work_items"].asBool();

        if (canView || entityType != "WORK_ITEM") {
            NotificationWebSocketController::sendNotificationToUser(email, fullMsg);
        } else {
            NotificationWebSocketController::sendNotificationToUser(email, maskedMsg);
        }
    }
}

void NotificationWebSocketController::startNotificationListener(const std::string &conninfo)
{
    // 별도 백그라운드 워커 스레드에서 PostgreSQL LISTEN/NOTIFY 전용 커넥션 유지
    std::thread listenerThread([conninfo]() {
        LOG_INFO << "[NotificationListener] Starting PostgreSQL LISTEN thread on channel: activity_notification_channel";

        while (true)
        {
            PGconn *conn = PQconnectdb(conninfo.c_str());
            if (PQstatus(conn) != CONNECTION_OK)
            {
                LOG_WARN << "[NotificationListener] DB connection failed: " << PQerrorMessage(conn) << ". Retrying in 5 seconds...";
                PQfinish(conn);
                std::this_thread::sleep_for(std::chrono::seconds(5));
                continue;
            }

            PGresult *res = PQexec(conn, "LISTEN activity_notification_channel");
            if (PQresultStatus(res) != PGRES_COMMAND_OK)
            {
                LOG_ERROR << "[NotificationListener] LISTEN command failed: " << PQerrorMessage(conn);
                PQclear(res);
                PQfinish(conn);
                std::this_thread::sleep_for(std::chrono::seconds(5));
                continue;
            }
            PQclear(res);

            LOG_INFO << "[NotificationListener] Successfully listening on 'activity_notification_channel'";

            int sock = PQsocket(conn);
            if (sock < 0)
            {
                LOG_ERROR << "[NotificationListener] Invalid socket descriptor";
                PQfinish(conn);
                std::this_thread::sleep_for(std::chrono::seconds(5));
                continue;
            }

            // 폴링 및 노티피케이션 처리 루프
            while (true)
            {
                fd_set input_mask;
                FD_ZERO(&input_mask);
                FD_SET(sock, &input_mask);

                struct timeval timeout;
                timeout.tv_sec = 3;
                timeout.tv_usec = 0;

                int selRes = select(sock + 1, &input_mask, NULL, NULL, &timeout);
                if (selRes < 0)
                {
                    if (errno == EINTR) continue;
                    LOG_ERROR << "[NotificationListener] select error: " << strerror(errno);
                    break;
                }

                PQconsumeInput(conn);
                if (PQstatus(conn) != CONNECTION_OK)
                {
                    LOG_WARN << "[NotificationListener] Connection lost during consumeInput. Reconnecting...";
                    break;
                }

                PGnotify *notify;
                while ((notify = PQnotifies(conn)) != NULL)
                {
                    std::string payload(notify->extra);
                    PQfreemem(notify);

                    // 메인 이벤트 루프로 디스패치하여 비동기 처리
                    drogon::app().getLoop()->queueInLoop([payload]() {
                        processActivityNotification(payload);
                    });
                }
            }

            PQfinish(conn);
            std::this_thread::sleep_for(std::chrono::seconds(2));
        }
    });

    listenerThread.detach();
}

