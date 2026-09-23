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

namespace
{
// JSON 값을 문자열로 직렬화한다. (WebSocket 프레임 전송용)
std::string toJsonString(const Json::Value &value)
{
    Json::StreamWriterBuilder writer;
    return Json::writeString(writer, value);
}
} // namespace

// JWT Access Token 을 검증하고 user_email 을 반환한다. 검증에 실패하면 빈 문자열을 반환한다.
std::string NotificationWebSocketController::verifyAccessToken(const std::string &token)
{
    if (token.empty())
    {
        return "";
    }

    auto secret = drogon::app().getCustomConfig()["jwt_secret"].asString();
    try
    {
        auto verifier = jwt::verify()
            .allow_algorithm(jwt::algorithm::hs256{secret})
            .with_issuer("grad_server");

        auto decoded = jwt::decode(token);
        verifier.verify(decoded);

        return decoded.get_payload_claim("user_email").as_string();
    }
    catch (const std::exception &e)
    {
        LOG_WARN << "WebSocket handshake failed: Invalid or expired token. Reason: " << e.what();
        return "";
    }
}

// 인증된 연결을 샤드에 등록한다.
// 1) 끊긴 연결을 정리하고 2) 같은 client_id 의 기존 연결은 교체하며 3) 새 연결을 추가한다.
// 다른 client_id(다른 기기)의 연결은 그대로 유지한다.
void NotificationWebSocketController::registerConnection(const WebSocketConnectionPtr &wsConnPtr,
                                                         const std::string &user_email,
                                                         const std::string &client_id,
                                                         const std::shared_ptr<WsSession> &session)
{
    std::vector<WebSocketConnectionPtr> replacedConnections;
    size_t activeCount = 0;

    auto &shard = getShard(user_email);
    {
        std::unique_lock<std::shared_mutex> lock(shard.mutex);
        auto &sessions = shard.connections[user_email];

        // 1. close 콜백을 놓친 소켓을 함께 회수한다.
        sessions.erase(
            std::remove_if(sessions.begin(), sessions.end(),
                           [](const WebSocketConnectionPtr &conn) {
                               return !conn || conn->disconnected();
                           }),
            sessions.end());

        // 2. 같은 client_id 의 연결은 재연결로 인한 중복이므로 교체 대상으로 분리한다.
        if (!client_id.empty())
        {
            sessions.erase(
                std::remove_if(sessions.begin(), sessions.end(),
                               [&client_id, &replacedConnections](const WebSocketConnectionPtr &conn) {
                                   auto previous = conn->getContext<WsSession>();
                                   if (previous && previous->client_id == client_id)
                                   {
                                       replacedConnections.push_back(conn);
                                       return true;
                                   }
                                   return false;
                               }),
                sessions.end());
        }

        sessions.push_back(wsConnPtr);
        activeCount = sessions.size();
    }

    // 3. 교체 대상이 된 기존 연결은 락을 놓은 뒤 닫는다.
    for (const auto &conn : replacedConnections)
    {
        if (conn && conn != wsConnPtr)
        {
            conn->forceClose();
        }
    }

    wsConnPtr->setContext(session);

    LOG_INFO << "WebSocket connected: " << user_email
             << " (client_id: " << (client_id.empty() ? "-" : client_id)
             << ", active sessions: " << activeCount << ")";
}

void NotificationWebSocketController::handleNewConnection(const HttpRequestPtr &req, const WebSocketConnectionPtr &wsConnPtr)
{
    // 1. 세션을 만들어 연결에 바인딩한다. 인증이 끝나기 전까지 authenticated 는 false 다.
    auto session = std::make_shared<WsSession>();
    session->client_id = req->getParameter("client_id");
    wsConnPtr->setContext(session);

    // 2. 구버전 호환: 쿼리 파라미터로 토큰이 오면 기존 방식대로 즉시 인증한다.
    //    (서버를 먼저 배포한 뒤 클라이언트를 전환하는 무중단 배포용)
    auto queryToken = req->getParameter("token");
    if (!queryToken.empty())
    {
        auto userEmail = verifyAccessToken(queryToken);
        if (userEmail.empty())
        {
            wsConnPtr->forceClose();
            return;
        }

        session->user_email = userEmail;
        session->authenticated = true;
        registerConnection(wsConnPtr, userEmail, session->client_id, session);

        Json::Value welcome;
        welcome["type"] = "SYSTEM";
        welcome["message"] = "Connected to real-time notification service.";
        wsConnPtr->send(toJsonString(welcome));
        return;
    }

    // 3. 신규 방식: 첫 프레임으로 오는 AUTH 메시지를 기다린다.
    //    제한 시간 안에 인증하지 못하면 자원을 붙잡고 있지 않도록 연결을 닫는다.
    std::weak_ptr<WebSocketConnection> weakConn = wsConnPtr;
    drogon::app().getLoop()->runAfter(AUTH_DEADLINE_SECONDS, [weakConn, session]() {
        auto conn = weakConn.lock();
        if (conn && !session->authenticated && !conn->disconnected())
        {
            LOG_WARN << "WebSocket handshake failed: AUTH frame was not received in time.";
            conn->forceClose();
        }
    });
}

void NotificationWebSocketController::handleNewMessage(const WebSocketConnectionPtr &wsConnPtr, std::string &&message, const WebSocketMessageType &type)
{
    auto session = wsConnPtr->getContext<WsSession>();
    if (!session)
    {
        wsConnPtr->forceClose();
        return;
    }

    // 1. 인증 전 연결은 AUTH 프레임 하나만 허용한다.
    if (!session->authenticated)
    {
        Json::Reader reader;
        Json::Value root;
        const bool isAuthFrame = reader.parse(message, root) &&
                                 root.isMember("type") &&
                                 root["type"].asString() == "AUTH";

        if (!isAuthFrame)
        {
            LOG_WARN << "WebSocket handshake failed: The first frame must be an AUTH message.";
            wsConnPtr->forceClose();
            return;
        }

        auto userEmail = verifyAccessToken(root["token"].asString());
        if (userEmail.empty())
        {
            // 클라이언트가 무한 재연결에 빠지지 않도록 인증 실패를 명시적으로 알린 뒤 닫는다.
            Json::Value failure;
            failure["type"] = "AUTH_FAILED";
            failure["message"] = "Invalid or expired access token.";
            wsConnPtr->send(toJsonString(failure));
            wsConnPtr->forceClose();
            return;
        }

        if (root.isMember("client_id") && !root["client_id"].isNull())
        {
            session->client_id = root["client_id"].asString();
        }
        session->user_email = userEmail;
        session->authenticated = true;

        registerConnection(wsConnPtr, userEmail, session->client_id, session);

        Json::Value ack;
        ack["type"] = "AUTH_OK";
        ack["message"] = "Connected to real-time notification service.";
        wsConnPtr->send(toJsonString(ack));
        return;
    }

    // 2. 인증된 연결의 메시지는 원문을 남기지 않고 타입만 처리한다.
    Json::Reader reader;
    Json::Value root;
    if (!reader.parse(message, root))
    {
        return;
    }

    const std::string messageType = root.isMember("type") ? root["type"].asString() : std::string();
    if (messageType == "PING")
    {
        Json::Value pong;
        pong["type"] = "PONG";
        wsConnPtr->send(toJsonString(pong));
        return;
    }

    LOG_DEBUG << "WebSocket message from " << session->user_email << " (type: " << messageType << ")";
}

void NotificationWebSocketController::handleConnectionClosed(const WebSocketConnectionPtr &wsConnPtr)
{
    auto session = wsConnPtr->getContext<WsSession>();
    if (!session || !session->authenticated)
    {
        // 인증 전에 끊긴 연결은 샤드에 등록된 적이 없다.
        return;
    }

    const std::string user_email = session->user_email;
    auto &shard = getShard(user_email);
    {
        std::unique_lock<std::shared_mutex> lock(shard.mutex);
        auto it = shard.connections.find(user_email);
        if (it != shard.connections.end())
        {
            auto &vec = it->second;
            // 해당 유저의 샤드에서 이 연결만 선택 제거
            vec.erase(
                std::remove_if(vec.begin(), vec.end(),
                               [&wsConnPtr](const WebSocketConnectionPtr &conn) {
                                   return conn == wsConnPtr || !conn || conn->disconnected();
                               }),
                vec.end());

            if (vec.empty())
            {
                shard.connections.erase(it);
            }
        }
    }
    LOG_INFO << "WebSocket disconnected: " << user_email;
}

bool NotificationWebSocketController::sendNotificationToUser(const std::string &user_email, const std::string &message)
{
    std::vector<WebSocketConnectionPtr> targetConnections;
    bool hasDeadConnection = false;

    // 1. 해당 샤드에서 읽기 락을 잡고 살아 있는 연결만 복사한다. (Copy-out)
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
                else
                {
                    hasDeadConnection = true;
                }
            }
        }
    }

    // 2. 끊긴 연결이 섞여 있었다면 회수한다. (close 콜백을 놓친 half-open 소켓 정리)
    if (hasDeadConnection)
    {
        std::unique_lock<std::shared_mutex> lock(shard.mutex);
        auto it = shard.connections.find(user_email);
        if (it != shard.connections.end())
        {
            auto &vec = it->second;
            vec.erase(
                std::remove_if(vec.begin(), vec.end(),
                               [](const WebSocketConnectionPtr &conn) {
                                   return !conn || !conn->connected();
                               }),
                vec.end());

            if (vec.empty())
            {
                shard.connections.erase(it);
            }
        }
    }

    // 3. 락을 놓은 뒤 실제 네트워크 전송을 수행한다.
    for (const auto &conn : targetConnections)
    {
        conn->send(message);
    }

    return !targetConnections.empty();
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

    // 알림 제목만 서버가 결정한다. 본문 문장은 클라이언트가 원시 값으로 생성한다.
    std::string title;
    if (entityType == "WORK_ITEM") title = "업무 알림";
    else if (entityType == "RECURRING_RULE") title = "일정 알림";
    else if (entityType == "NODE") title = "노드 알림";
    else if (entityType == "ROLE" || entityType == "AUTHORITY") title = "권한/역할 알림";
    else if (entityType == "FILE") title = "파일 알림";
    else if (entityType == "COMMENT") title = "댓글 알림";
    else title = "활동 알림";

    std::string workItemId = root.isMember("work_item_id") && !root["work_item_id"].isNull() ? root["work_item_id"].asString() : "";
    // 일정(정기 규칙) 전용 파일 활동 여부: 수신 클라이언트가 일정 데이터를 다시 조회하도록 알려주는 구분자
    bool isRecurringFile = root.isMember("is_recurring_file") && root["is_recurring_file"].asBool();

    std::string linkUrl;
    if (entityType == "RECURRING_RULE") {
        linkUrl = "/workspace?view=schedules&nodeId=" + std::to_string(nodeId) + "&ruleId=" + entityId;
    } else if ((entityType == "WORK_ITEM" || entityType == "COMMENT" || entityType == "FILE") && !workItemId.empty()) {
        linkUrl = "/work-items/" + workItemId;
    } else if (entityType == "ROLE" || entityType == "AUTHORITY") {
        linkUrl = "/workspace?nodeId=" + std::to_string(nodeId) + "&view=roles";
    } else if (entityType == "NODE") {
        linkUrl = "/workspace?nodeId=" + std::to_string(nodeId);
    } else {
        linkUrl = "/workspace?nodeId=" + std::to_string(nodeId) + "&view=timeline";
    }

    // 1. 업무 상세 조회 권한이 있는 사용자용 페이로드 직렬화
    Json::Value fullPayload;
    fullPayload["type"] = "NOTIFICATION";
    fullPayload["sub_type"] = "ACTIVITY";
    fullPayload["data"]["notification_id"] = activityId;
    fullPayload["data"]["node_id"] = nodeId;
    fullPayload["data"]["entity_type"] = entityType;
    fullPayload["data"]["entity_id"] = entityId;
    if (!workItemId.empty()) {
        fullPayload["data"]["work_item_id"] = workItemId;
    }
    fullPayload["data"]["action"] = actionType;
    fullPayload["data"]["is_recurring_file"] = isRecurringFile;
    fullPayload["data"]["actor_user_id"] = actorUserId;
    fullPayload["data"]["actor_name"] = actorName;
    fullPayload["data"]["title"] = title;
    fullPayload["data"]["target_name"] = targetName;

    // 변경 상세는 가공하지 않고 원시 값 그대로 전달한다(문장은 클라이언트가 생성).
    if (root.isMember("field_name") && !root["field_name"].isNull()) {
        fullPayload["data"]["field_name"] = root["field_name"].asString();
    } else {
        fullPayload["data"]["field_name"] = Json::Value();
    }
    if (root.isMember("old_value") && !root["old_value"].isNull()) {
        fullPayload["data"]["old_value"] = root["old_value"].asString();
    } else {
        fullPayload["data"]["old_value"] = Json::Value();
    }
    if (root.isMember("new_value") && !root["new_value"].isNull()) {
        fullPayload["data"]["new_value"] = root["new_value"].asString();
    } else {
        fullPayload["data"]["new_value"] = Json::Value();
    }

    fullPayload["data"]["link_url"] = linkUrl;
    fullPayload["data"]["is_read"] = false;
    fullPayload["data"]["created_at"] = createdAt;
    fullPayload["data"]["can_view_detail"] = true;

    // 2. 업무 상세 조회 권한이 없는(마스킹된) 사용자용 페이로드 직렬화
    Json::Value maskedPayload = fullPayload;
    if ((entityType == "WORK_ITEM" || entityType == "COMMENT" || entityType == "FILE") && !isRecurringFile) {
        // 업무 상세를 볼 수 없는 사용자에게는 대상 이름과 변경 상세를 노출하지 않는다.
        maskedPayload["data"]["target_name"] = "";
        maskedPayload["data"]["field_name"] = Json::Value();
        maskedPayload["data"]["old_value"] = Json::Value();
        maskedPayload["data"]["new_value"] = Json::Value();
        maskedPayload["data"]["link_url"] = "/workspace?nodeId=" + std::to_string(nodeId) + "&view=timeline";
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
        // 일정(정기 규칙) 파일은 업무 상세 권한과 무관하게 마스킹하지 않는다.
        bool isWorkRelated = (entityType == "WORK_ITEM" || entityType == "COMMENT" || entityType == "FILE") && !isRecurringFile;
        if (canView || !isWorkRelated) {
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
