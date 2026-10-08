#include "GithubWebSocketController.h"

#include "ResponseUtils.h"

#include <drogon/drogon.h>
#include <jwt-cpp/jwt.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <functional>
#include <sstream>

using namespace api;

// 정적 샤드 배열 초기화
std::array<GithubWebSocketController::ConnectionShard, GithubWebSocketController::SHARD_COUNT>
    GithubWebSocketController::shards_;

namespace
{
// JSON 값을 WebSocket 텍스트 프레임 문자열로 만든다.
std::string toJsonString(const Json::Value &value)
{
    Json::StreamWriterBuilder writer;
    return Json::writeString(writer, value);
}

// 방 키는 §3.3 규칙: repo:{repo_id}:branch:{branch}
std::string roomKeyOf(int repoId, const std::string &branch)
{
    return "repo:" + std::to_string(repoId) + ":branch:" + branch;
}

// 같은 저장소의 모든 방을 찾기 위한 접두사. repo:1: 과 repo:12: 가 섞이지 않도록 'branch:' 로 끝낸다.
std::string repositoryPrefix(int repoId)
{
    return "repo:" + std::to_string(repoId) + ":branch:";
}

// 연결마다 고유한 접속 식별자. github_branch_presence.connection_id 로 쓰인다.
std::string makeConnectionId()
{
    static std::atomic<unsigned long long> counter{0};
    const auto ticks = std::chrono::steady_clock::now().time_since_epoch().count();
    std::ostringstream oss;
    oss << "ws-" << std::hex << ticks << "-" << counter.fetch_add(1);
    return oss.str();
}

// integrated_data 결과를 data 배열로 바꾼다(HTTP 컨트롤러와 같은 규격).
Json::Value rowsToArray(const orm::Result &result)
{
    return app_utils::parseIntegratedDataResult(result)["data"];
}

// RAISE EXCEPTION 메시지의 '[Pxxxx]' 에서 코드를 뽑는다. 없으면 "500".
std::string extractErrorCode(const std::string &message)
{
    const std::size_t start = message.find("[P");
    if (start != std::string::npos && start + 6 < message.size() && message[start + 6] == ']')
    {
        return message.substr(start + 1, 5);
    }
    return "500";
}

void sendEvent(const WebSocketConnectionPtr &wsConnPtr, const Json::Value &event)
{
    if (wsConnPtr && wsConnPtr->connected())
    {
        wsConnPtr->send(toJsonString(event));
    }
}

void sendError(const WebSocketConnectionPtr &wsConnPtr, const std::string &code, const std::string &message)
{
    Json::Value event;
    event["type"] = "err";
    event["code"] = code;
    event["message"] = message;
    sendEvent(wsConnPtr, event);
}

// DB 오류를 제어 소켓 규격(err)으로 바꾼다. 코드는 SQL 이 던진 Pxxxx 를 그대로 쓴다.
void sendDbError(const WebSocketConnectionPtr &wsConnPtr, const orm::DrogonDbException &e)
{
    Json::Value detail = app_utils::parseDbError(e);
    sendError(wsConnPtr, extractErrorCode(e.base().what()), detail["message"].asString());
}

Json::Value presenceEvent(int repoId, const std::string &branch, const Json::Value &presence)
{
    Json::Value event;
    event["type"] = "presence_updated";
    event["repo_id"] = repoId;
    event["branch"] = branch;
    event["presence"] = presence;
    return event;
}

// 접속자 등록(멱등). 같은 connection_id 는 브랜치를 옮기고 last_seen_at 을 갱신한다.
// 반환값은 그 브랜치의 현재 접속자 목록이다(heartbeat 는 결과를 쓰지 않는다).
Json::Value registerPresence(const std::string &requester, int repoId, const std::string &branch,
                             const std::string &connectionId)
{
    auto db = app().getDbClient();
    return rowsToArray(db->execSqlSync("SELECT * FROM upsert_github_branch_presence($1, $2, $3, $4)", requester,
                                       repoId, branch, connectionId));
}

// 브랜치 하나의 접속자 목록만 뽑는다(방 목록 갱신 브로드캐스트용).
Json::Value presenceOfBranch(const std::string &requester, int repoId, const std::string &branch)
{
    auto db = app().getDbClient();
    auto branches = rowsToArray(db->execSqlSync("SELECT * FROM get_github_branches($1, $2)", requester, repoId));
    for (const auto &item : branches)
    {
        if (item["name"].asString() == branch)
        {
            return item["presence"];
        }
    }
    return Json::Value(Json::arrayValue);
}
} // namespace

// JWT Access Token 을 검증하고 user_email 을 돌려준다. 실패하면 빈 문자열.
std::string GithubWebSocketController::verifyAccessToken(const std::string &token)
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
        LOG_WARN << "GitHub WebSocket handshake failed: invalid or expired token. Reason: " << e.what();
        return "";
    }
}

GithubWebSocketController::ConnectionShard &GithubWebSocketController::getShard(const std::string &key)
{
    size_t index = std::hash<std::string>{}(key) % SHARD_COUNT;
    return shards_[index];
}

// 인증된 연결을 사용자 목록에 등록한다.
// 1) 끊긴 연결을 정리하고 2) 같은 client_id 의 기존 연결은 교체하며 3) 새 연결을 추가한다.
void GithubWebSocketController::registerConnection(const WebSocketConnectionPtr &wsConnPtr,
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
                           [](const WebSocketConnectionPtr &conn) { return !conn || conn->disconnected(); }),
            sessions.end());

        // 2. 같은 client_id(같은 창의 재연결)의 기존 연결은 교체 대상으로 분리한다.
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

    LOG_INFO << "GitHub WebSocket connected: " << user_email
             << " (client_id: " << (client_id.empty() ? "-" : client_id)
             << ", active sessions: " << activeCount << ")";
}

void GithubWebSocketController::unregisterConnection(const std::string &user_email,
                                                     const WebSocketConnectionPtr &wsConnPtr)
{
    auto &shard = getShard(user_email);
    std::unique_lock<std::shared_mutex> lock(shard.mutex);

    auto it = shard.connections.find(user_email);
    if (it == shard.connections.end())
    {
        return;
    }

    auto &sessions = it->second;
    sessions.erase(
        std::remove_if(sessions.begin(), sessions.end(),
                       [&wsConnPtr](const WebSocketConnectionPtr &conn) {
                           return conn == wsConnPtr || !conn || conn->disconnected();
                       }),
        sessions.end());

    if (sessions.empty())
    {
        shard.connections.erase(it);
    }
}

void GithubWebSocketController::addToRoom(const std::string &room_key, const WebSocketConnectionPtr &wsConnPtr)
{
    auto &shard = getShard(room_key);
    std::unique_lock<std::shared_mutex> lock(shard.mutex);
    auto &members = shard.rooms[room_key];

    // 끊긴 소켓과 자기 자신을 먼저 걷어내고 넣는다(join 을 두 번 보내도 중복이 생기지 않는다).
    members.erase(
        std::remove_if(members.begin(), members.end(),
                       [&wsConnPtr](const WebSocketConnectionPtr &conn) {
                           return !conn || !conn->connected() || conn == wsConnPtr;
                       }),
        members.end());
    members.push_back(wsConnPtr);
}

void GithubWebSocketController::removeFromRoom(const std::string &room_key,
                                               const WebSocketConnectionPtr &wsConnPtr)
{
    if (room_key.empty())
    {
        return;
    }

    auto &shard = getShard(room_key);
    std::unique_lock<std::shared_mutex> lock(shard.mutex);

    auto it = shard.rooms.find(room_key);
    if (it == shard.rooms.end())
    {
        return;
    }

    auto &members = it->second;
    members.erase(
        std::remove_if(members.begin(), members.end(),
                       [&wsConnPtr](const WebSocketConnectionPtr &conn) {
                           return conn == wsConnPtr || !conn || !conn->connected();
                       }),
        members.end());

    if (members.empty())
    {
        shard.rooms.erase(it);
    }
}

bool GithubWebSocketController::sendToRoom(const std::string &room_key, const std::string &message)
{
    auto &shard = getShard(room_key);
    std::vector<WebSocketConnectionPtr> targets;
    bool hasDeadConnection = false;

    // 1. 읽기 락을 잡고 살아 있는 연결만 복사한다(Copy-out).
    {
        std::shared_lock<std::shared_mutex> lock(shard.mutex);
        auto it = shard.rooms.find(room_key);
        if (it != shard.rooms.end())
        {
            for (const auto &conn : it->second)
            {
                if (conn && conn->connected())
                {
                    targets.push_back(conn);
                }
                else
                {
                    hasDeadConnection = true;
                }
            }
        }
    }

    // 2. 끊긴 연결이 섞여 있었으면 회수한다(half-open 소켓 정리).
    if (hasDeadConnection)
    {
        std::unique_lock<std::shared_mutex> lock(shard.mutex);
        auto it = shard.rooms.find(room_key);
        if (it != shard.rooms.end())
        {
            auto &members = it->second;
            members.erase(
                std::remove_if(members.begin(), members.end(),
                               [](const WebSocketConnectionPtr &conn) { return !conn || !conn->connected(); }),
                members.end());
            if (members.empty())
            {
                shard.rooms.erase(it);
            }
        }
    }

    // 3. 락을 놓은 뒤 실제 네트워크 전송을 수행한다.
    for (const auto &conn : targets)
    {
        conn->send(message);
    }

    return !targets.empty();
}

bool GithubWebSocketController::broadcastToBranch(int repo_id, const std::string &branch, const Json::Value &event)
{
    return sendToRoom(roomKeyOf(repo_id, branch), toJsonString(event));
}

bool GithubWebSocketController::broadcastToRepository(int repo_id, const Json::Value &event)
{
    const std::string prefix = repositoryPrefix(repo_id);
    const std::string message = toJsonString(event);

    // 방 목록은 샤드마다 나뉘어 있으므로, 먼저 이 저장소의 방 키를 모은다.
    std::vector<std::string> roomKeys;
    for (auto &shard : shards_)
    {
        std::shared_lock<std::shared_mutex> lock(shard.mutex);
        for (const auto &entry : shard.rooms)
        {
            if (entry.first.compare(0, prefix.size(), prefix) == 0)
            {
                roomKeys.push_back(entry.first);
            }
        }
    }

    bool sent = false;
    for (const auto &key : roomKeys)
    {
        sent = sendToRoom(key, message) || sent;
    }
    return sent;
}

void GithubWebSocketController::handleNewConnection(const HttpRequestPtr &req, const WebSocketConnectionPtr &wsConnPtr)
{
    // 1. 세션을 만들어 연결에 바인딩한다. 인증 전에는 authenticated 가 false 다.
    auto session = std::make_shared<WsSession>();
    session->client_id = req->getParameter("client_id");
    session->connection_id = makeConnectionId();
    wsConnPtr->setContext(session);

    // 2. 첫 프레임 auth 를 기다린다. 제한 시간을 넘기면 자원을 붙잡지 않도록 연결을 닫는다.
    //    쿼리 토큰은 받지 않는다 — 토큰이 URL·프록시 로그에 남지 않게 하기 위함이다(§3.4).
    std::weak_ptr<WebSocketConnection> weakConn = wsConnPtr;
    drogon::app().getLoop()->runAfter(AUTH_DEADLINE_SECONDS, [weakConn, session]() {
        auto conn = weakConn.lock();
        if (conn && !session->authenticated && !conn->disconnected())
        {
            LOG_WARN << "GitHub WebSocket handshake failed: auth frame was not received in time.";
            conn->forceClose();
        }
    });
}

void GithubWebSocketController::handleNewMessage(const WebSocketConnectionPtr &wsConnPtr, std::string &&message,
                                                 const WebSocketMessageType &)
{
    auto session = wsConnPtr->getContext<WsSession>();
    if (!session)
    {
        wsConnPtr->forceClose();
        return;
    }

    Json::Reader reader;
    Json::Value root;
    if (!reader.parse(message, root) || !root.isObject())
    {
        if (!session->authenticated)
        {
            wsConnPtr->forceClose();
        }
        return;
    }

    const std::string messageType =
        (root.isMember("type") && root["type"].isString()) ? root["type"].asString() : std::string();

    // 1. 인증 전 연결은 auth 프레임 하나만 허용한다.
    if (!session->authenticated)
    {
        // §3.3 표는 소문자 auth 를 쓴다. 알림 소켓과 같은 대문자 AUTH 도 함께 받아 준다.
        if (messageType != "auth" && messageType != "AUTH")
        {
            LOG_WARN << "GitHub WebSocket handshake failed: the first frame must be an auth message.";
            wsConnPtr->forceClose();
            return;
        }

        const std::string userEmail = verifyAccessToken(root["token"].asString());
        if (userEmail.empty())
        {
            // 무한 재연결에 빠지지 않도록 실패를 명시적으로 알린 뒤 닫는다.
            Json::Value failure;
            failure["type"] = "AUTH_FAILED";
            failure["message"] = "유효하지 않거나 만료된 토큰입니다.";
            sendEvent(wsConnPtr, failure);
            wsConnPtr->forceClose();
            return;
        }

        if (root.isMember("client_id") && root["client_id"].isString() && !root["client_id"].asString().empty())
        {
            session->client_id = root["client_id"].asString();
        }
        // 확장이 접속 식별자를 직접 주면 재접속 시 접속자 행을 승계할 수 있다(컬럼 길이에 맞춘다).
        if (root.isMember("connection_id") && root["connection_id"].isString())
        {
            const std::string supplied = root["connection_id"].asString();
            if (!supplied.empty() && supplied.size() <= 100)
            {
                session->connection_id = supplied;
            }
        }

        session->user_email = userEmail;
        session->authenticated = true;
        registerConnection(wsConnPtr, userEmail, session->client_id, session);

        Json::Value ack;
        ack["type"] = "AUTH_OK";
        ack["message"] = "GitHub 제어 소켓에 연결되었습니다.";
        sendEvent(wsConnPtr, ack);
        return;
    }

    // 2. 인증된 연결의 메시지 처리.
    //    접속자 등록·해제는 짧은 단일 쿼리라 이벤트 루프에서 그대로 수행한다(느린 git 작업만 워커로 뺀다).
    if (messageType == "join" || messageType == "switch_branch")
    {
        const int repoId = root["repo_id"].isInt() ? root["repo_id"].asInt() : 0;
        const std::string branch =
            (messageType == "join") ? (root["branch"].isString() ? root["branch"].asString() : std::string())
                                    : (root["to"].isString() ? root["to"].asString() : std::string());
        if (repoId <= 0 || branch.empty())
        {
            sendError(wsConnPtr, "400",
                      (messageType == "join") ? "join 에는 repo_id 와 branch 가 필요합니다."
                                              : "switch_branch 에는 repo_id 와 to 가 필요합니다.");
            return;
        }
        enterRoom(wsConnPtr, session, repoId, branch);
        return;
    }

    if (messageType == "leave")
    {
        // §3.3 의 leave 는 repo_id/branch 를 함께 받지만, 접속자 행은 connection_id 로만 찾는다.
        if (session->repo_id != 0 && !session->branch.empty())
        {
            removeFromRoom(roomKeyOf(session->repo_id, session->branch), wsConnPtr);
        }
        removePresenceAndNotify(session);
        session->repo_id = 0;
        session->branch.clear();
        return;
    }

    if (messageType == "heartbeat")
    {
        // 방에 들어가 있지 않으면 갱신할 접속자 행이 없다.
        if (session->repo_id != 0 && !session->branch.empty())
        {
            try
            {
                registerPresence(session->user_email, session->repo_id, session->branch, session->connection_id);
            }
            catch (const orm::DrogonDbException &e)
            {
                LOG_WARN << "GitHub presence heartbeat 실패: " << e.base().what();
            }
        }
        return;
    }

    if (messageType == "ping" || messageType == "PING")
    {
        Json::Value pong;
        pong["type"] = "PONG";
        sendEvent(wsConnPtr, pong);
        return;
    }

    LOG_DEBUG << "GitHub WebSocket message from " << session->user_email << " (type: " << messageType << ")";
}

void GithubWebSocketController::enterRoom(const WebSocketConnectionPtr &wsConnPtr,
                                          const std::shared_ptr<WsSession> &session, int repo_id,
                                          const std::string &branch)
{
    // 1. 접속자 행을 등록한다(멱등). 권한·저장소·브랜치 확인은 SQL 함수가 맡는다.
    Json::Value presence;
    try
    {
        presence = registerPresence(session->user_email, repo_id, branch, session->connection_id);
    }
    catch (const orm::DrogonDbException &e)
    {
        sendDbError(wsConnPtr, e);
        return;
    }

    // 2. 이전 방에서 빼고 새 방에 넣는다(join 을 다시 보내면 브랜치 이동으로 동작한다).
    const int previousRepo = session->repo_id;
    const std::string previousBranch = session->branch;
    const bool hadPrevious = previousRepo != 0 && !previousBranch.empty();
    const bool moved = hadPrevious && (previousRepo != repo_id || previousBranch != branch);

    if (moved)
    {
        removeFromRoom(roomKeyOf(previousRepo, previousBranch), wsConnPtr);
    }

    session->repo_id = repo_id;
    session->branch = branch;
    addToRoom(roomKeyOf(repo_id, branch), wsConnPtr);

    // 3. 이전 브랜치의 목록도 바뀌었다고 알린다(조회 실패해도 입장 자체는 성공으로 둔다).
    if (moved)
    {
        Json::Value left = presenceEvent(previousRepo, previousBranch, Json::Value(Json::arrayValue));
        try
        {
            left["presence"] = presenceOfBranch(session->user_email, previousRepo, previousBranch);
        }
        catch (const orm::DrogonDbException &e)
        {
            LOG_WARN << "이전 브랜치 접속자 목록 조회 실패: " << e.base().what();
        }
        broadcastToRepository(previousRepo, left);
    }

    // 4. 새 접속자 목록을 저장소 전체에 알린다(요청자 포함).
    //    Editing 뷰가 접속자를 브랜치별로 보여 주려면(§15.5) 방 하나가 아니라 저장소의 모든 방이
    //    이 목록을 알아야 한다. `presence_updated` 는 자기 branch 를 담으므로 받는 쪽이 구분한다.
    broadcastToRepository(repo_id, presenceEvent(repo_id, branch, presence));
}

bool GithubWebSocketController::removePresenceAndNotify(const std::shared_ptr<WsSession> &session)
{
    if (!session || session->user_email.empty() || session->connection_id.empty())
    {
        return false;
    }

    Json::Value removed;
    try
    {
        auto db = app().getDbClient();
        Json::Value rows = rowsToArray(db->execSqlSync("SELECT * FROM delete_github_branch_presence($1, $2)",
                                                       session->user_email, session->connection_id));
        if (rows.empty())
        {
            // 이미 정리된 접속(leave 를 두 번 보냈거나 소켓이 먼저 끊긴 경우).
            return false;
        }
        removed = rows[0];
    }
    catch (const orm::DrogonDbException &e)
    {
        LOG_WARN << "GitHub presence 해제 실패: " << e.base().what();
        return false;
    }

    const int repoId = removed["repo_id"].isInt() ? removed["repo_id"].asInt() : session->repo_id;
    const std::string branch = removed["branch"].isString() ? removed["branch"].asString() : session->branch;
    if (repoId == 0 || branch.empty())
    {
        return true;
    }

    // 남은 접속자 목록을 만들어 저장소 전체에 알린다.
    Json::Value left = presenceEvent(repoId, branch, Json::Value(Json::arrayValue));
    try
    {
        left["presence"] = presenceOfBranch(session->user_email, repoId, branch);
    }
    catch (const orm::DrogonDbException &e)
    {
        LOG_WARN << "브랜치 접속자 목록 조회 실패: " << e.base().what();
    }
    broadcastToRepository(repoId, left);
    return true;
}

void GithubWebSocketController::handleConnectionClosed(const WebSocketConnectionPtr &wsConnPtr)
{
    auto session = wsConnPtr->getContext<WsSession>();
    if (!session || !session->authenticated)
    {
        // 인증 전에 끊긴 연결은 등록된 적이 없다.
        return;
    }

    // 1. 방 목록에서 먼저 뺀다(자기 자신에게 브로드캐스트하지 않도록).
    if (session->repo_id != 0 && !session->branch.empty())
    {
        removeFromRoom(roomKeyOf(session->repo_id, session->branch), wsConnPtr);
    }

    // 2. 접속자 행을 지우고 남은 접속자에게 알린다(leave 를 이미 보냈으면 아무 것도 하지 않는다).
    removePresenceAndNotify(session);

    // 3. 사용자 목록에서 제거한다.
    unregisterConnection(session->user_email, wsConnPtr);
    LOG_INFO << "GitHub WebSocket disconnected: " << session->user_email;
}