#include "CollabController.h"
#include "ResponseUtils.h"
#include "ValidationUtils.h"

#include <drogon/drogon.h>
#include <drogon/utils/Utilities.h>
#include <json/json.h>

#include <chrono>
#include <cctype>
#include <ctime>
#include <cstdlib>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <utility>

using namespace api;
using namespace drogon;
using namespace app_utils;

namespace {

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

// 티켓 TTL(초). 핸드오프 코드(§3.4)와 같은 값이다.
constexpr int kTicketTtlSeconds = 60;

// collab ↔ backend 내부 인증 헤더. 두 컨테이너만 아는 값이고 외부에 노출하지 않는다(§9.2).
constexpr char kInternalTokenHeader[] = "X-Internal-Token";

// 협업 편집의 쓰기 권한. 브랜치 생성/삭제·커밋과 같은 권한을 쓴다(§12.9).
// VIEWER 는 read-only 티켓을, MEMBER 이상은 can_write=true 티켓을 받는다.
constexpr char kWriteAuthority[] = "WI_PERSONAL_CHANGE";

// ---------------------------------------------------------------------------
// 응답 헬퍼 (GithubController 와 같은 규격: {status, data[], message})
// ---------------------------------------------------------------------------

HttpResponsePtr makeJsonResponse(const Json::Value &body, HttpStatusCode code) {
    auto resp = HttpResponse::newHttpJsonResponse(body);
    resp->setStatusCode(code);
    return resp;
}

HttpResponsePtr successResponse(const Json::Value &data, const std::string &message,
                                HttpStatusCode code = k200OK) {
    Json::Value ret;
    ret["status"] = "success";
    ret["data"] = data;
    if (!message.empty()) {
        ret["message"] = message;
    }
    return makeJsonResponse(ret, code);
}

HttpResponsePtr errorResponse(const std::string &code, const std::string &message,
                              HttpStatusCode httpCode) {
    Json::Value ret;
    ret["status"] = "error";
    ret["code"] = code;
    ret["message"] = message;
    return makeJsonResponse(ret, httpCode);
}

HttpResponsePtr dbErrorResponse(const orm::DrogonDbException &e) {
    Json::Value ret = parseDbError(e);
    auto httpCode = static_cast<HttpStatusCode>(ret["http_code"].asInt());
    ret.removeMember("http_code");
    return makeJsonResponse(ret, httpCode);
}

// 응답 규격은 항상 {status, data[], message} 다. 단건도 배열로 감싼다.
Json::Value singleItemArray(const Json::Value &item) {
    Json::Value array(Json::arrayValue);
    array.append(item);
    return array;
}

// 단건 조회 결과에서 첫 행만 꺼낸다.
bool singleRow(const orm::Result &result, Json::Value &out) {
    Json::Value rows = parseIntegratedDataResult(result)["data"];
    if (!rows.isArray() || rows.empty()) {
        return false;
    }
    out = rows[0];
    return true;
}

// JwtFilter 가 넣어 준 로그인 사용자 이메일
std::string requesterEmail(const HttpRequestPtr &req) {
    return req->attributes()->get<std::string>("user_email");
}

// DB 동기 호출은 이벤트 루프를 막으므로 워커 스레드에서 실행하고 응답만 되돌린다.
void runOffLoop(std::function<void(const HttpResponsePtr &)> &&callback,
                std::function<HttpResponsePtr()> &&work) {
    auto cb = std::make_shared<std::function<void(const HttpResponsePtr &)>>(std::move(callback));
    std::thread worker([cb, work = std::move(work)]() {
        HttpResponsePtr resp;
        try {
            resp = work();
        } catch (const orm::DrogonDbException &e) {
            resp = dbErrorResponse(e);
        } catch (const std::exception &e) {
            LOG_ERROR << "collab 핸들러 실패: " << e.what();
            resp = errorResponse("500", "서버 처리 중 오류가 발생했습니다.", k500InternalServerError);
        }
        app().getLoop()->queueInLoop([cb, resp]() { (*cb)(resp); });
    });
    worker.detach();
}

// ---------------------------------------------------------------------------
// 내부 토큰 / 시간 / 난수
// ---------------------------------------------------------------------------

// INTERNAL_TOKEN 은 환경변수에서만 읽는다. 없으면 티켓 소비를 전부 거부한다(fail-closed).
std::string internalToken() {
    const char *value = std::getenv("INTERNAL_TOKEN");
    return (value != nullptr) ? std::string(value) : std::string();
}

// 길이가 다르면 즉시 false, 같으면 전 바이트를 비교한다(타이밍 차이로 값을 알아내지 못하게).
bool constantTimeEquals(const std::string &a, const std::string &b) {
    if (a.size() != b.size()) {
        return false;
    }
    unsigned char diff = 0;
    for (std::size_t i = 0; i < a.size(); ++i) {
        diff |= static_cast<unsigned char>(a[i] ^ b[i]);
    }
    return diff == 0;
}

// 지금으로부터 seconds 뒤의 UTC 시각. 다른 API 의 jsonb 타임스탬프와 같은 표기를 쓴다.
std::string isoUtcAfter(int seconds) {
    const std::time_t at = std::chrono::system_clock::to_time_t(
        std::chrono::system_clock::now() + std::chrono::seconds(seconds));
    std::tm tm{};
#if defined(_WIN32)
    gmtime_s(&tm, &at);
#else
    gmtime_r(&at, &tm);
#endif
    char buffer[32];
    if (std::strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%S+00:00", &tm) == 0) {
        return "";
    }
    return std::string(buffer);
}

// 256비트 상당 난수(hex). 핸드오프 코드와 같은 강도다 — 추측으로 방에 들어오지 못하게 한다.
std::string randomToken() {
    const std::string raw = drogon::utils::getUuid() + drogon::utils::getUuid();
    std::string token;
    token.reserve(raw.size());
    for (char c : raw) {
        if (c == '-') {
            continue;
        }
        token.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
    }
    return token;
}

// ---------------------------------------------------------------------------
// 1회용 협업 티켓 저장소 (메모리)
// ---------------------------------------------------------------------------

// 티켓은 TTL 60초·1회용이고, 발급자(C++)와 소비자(collab)가 내부 API 로 이 프로세스에만
// 물어본다. 백엔드 인스턴스가 하나인 현재 배포에서는 메모리 저장이면 충분하므로
// DB 스키마를 늘리지 않는다(다중 인스턴스로 확장하면 공유 저장소로 옮긴다).
struct CollabTicket {
    std::string userEmail;
    std::string userName;
    int repoId = 0;
    int nodeId = 0;
    bool canWrite = false;
    std::chrono::steady_clock::time_point expiresAt;
};

class TicketStore {
  public:
    static TicketStore &instance() {
        static TicketStore store;
        return store;
    }

    std::string issue(const CollabTicket &ticket) {
        std::lock_guard<std::mutex> lock(mutex_);
        const auto now = std::chrono::steady_clock::now();
        sweepLocked(now);

        const std::string token = randomToken();
        tickets_.emplace(token, ticket);
        return token;
    }

    // 유효하면 값을 돌려주고 그 자리에서 지운다(1회용). 만료·미존재면 false.
    bool consume(const std::string &token, CollabTicket &out) {
        std::lock_guard<std::mutex> lock(mutex_);
        const auto now = std::chrono::steady_clock::now();
        sweepLocked(now);

        auto it = tickets_.find(token);
        if (it == tickets_.end() || it->second.expiresAt <= now) {
            return false;
        }
        out = it->second;
        tickets_.erase(it);
        return true;
    }

  private:
    // 만료된 티켓을 정리한다. 발급·소비 때마다 돌려도 항목 수가 적어 부담이 없다.
    void sweepLocked(std::chrono::steady_clock::time_point now) {
        for (auto it = tickets_.begin(); it != tickets_.end();) {
            if (it->second.expiresAt <= now) {
                it = tickets_.erase(it);
            } else {
                ++it;
            }
        }
    }

    std::mutex mutex_;
    std::unordered_map<std::string, CollabTicket> tickets_;
};

} // namespace

// ===========================================================================
// 확장 → C++ : 협업 티켓 발급 (§3.2, §12.1)
// ===========================================================================

// 확장은 앱에서 받은 JWT 로 이 API 를 부르고, 받은 티켓으로 문서 소켓에 붙는다.
// 티켓에는 브랜치를 담지 않는다 — 브랜치 전환은 그때 C++ 에 권한을 다시 묻는다(§12.9).
void CollabController::issueTicket(const HttpRequestPtr &req,
                                   std::function<void(const HttpResponsePtr &)> &&callback) {
    auto jsonPtr = req->getJsonObject();
    if (!jsonPtr || !validateInts(jsonPtr, "repo_id")) {
        callback(errorResponse("400", "필수 파라미터(repo_id)가 누락되었습니다.", k400BadRequest));
        return;
    }

    const std::string requester = requesterEmail(req);
    const int repoId = (*jsonPtr)["repo_id"].asInt();

    runOffLoop(std::move(callback), [requester, repoId]() -> HttpResponsePtr {
        auto db = app().getDbClient();

        // 1) 저장소가 연결돼 있고 요청자가 그 노드를 볼 수 있어야 한다.
        //    없으면 P0801, 권한이 없으면 P0103 을 DB 함수가 던진다.
        Json::Value repo;
        if (!singleRow(db->execSqlSync("SELECT * FROM get_github_repository_by_id($1, $2)",
                                       requester, repoId),
                       repo)) {
            return errorResponse("P0801", "연결된 저장소를 찾을 수 없습니다.", k404NotFound);
        }
        const int nodeId = repo["node_id"].asInt();

        // 2) 세션에 담을 이름과 쓰기 권한을 한 번에 읽는다.
        //    권한은 브랜치 생성/삭제·커밋과 같은 WI_PERSONAL_CHANGE 를 기준으로 한다.
        auto rows = db->execSqlSync(
            "SELECT u.name, check_authority_with_override(u.user_id, $2, $3) AS can_write "
            "FROM users u WHERE u.email = $1 AND u.is_deleted = FALSE",
            requester, nodeId, std::string(kWriteAuthority));
        if (rows.empty()) {
            return errorResponse("P0001", "요청자 계정을 찾을 수 없습니다.", k401Unauthorized);
        }
        const bool canWrite = rows[0]["can_write"].as<bool>();

        // 3) 티켓 발급 (TTL 60초·1회용). 저장소 정보는 여기서 확정하고 collab 에게 넘긴다.
        CollabTicket ticket;
        ticket.userEmail = requester;
        ticket.userName = rows[0]["name"].as<std::string>();
        ticket.repoId = repoId;
        ticket.nodeId = nodeId;
        ticket.canWrite = canWrite;
        ticket.expiresAt = std::chrono::steady_clock::now() + std::chrono::seconds(kTicketTtlSeconds);

        Json::Value item;
        item["ticket"] = TicketStore::instance().issue(ticket);
        item["repo_id"] = repoId;
        item["node_id"] = nodeId;
        item["expires_in"] = kTicketTtlSeconds;
        item["expires_at"] = isoUtcAfter(kTicketTtlSeconds);
        item["can_write"] = canWrite;

        return successResponse(singleItemArray(item), "협업 티켓을 발급했습니다.", k201Created);
    });
}

// ===========================================================================
// collab → C++ : 티켓 소비 (내부 전용)
// ===========================================================================

// collab 사이드카가 문서 소켓의 쿼리 티켓을 검증할 때 부른다. JWT 를 해석하지 않고
// 이 API 하나로 세션(사용자·저장소·권한)을 확정한다. 성공하면 티켓은 즉시 소비된다.
void CollabController::consumeTicket(const HttpRequestPtr &req,
                                     std::function<void(const HttpResponsePtr &)> &&callback) {
    // 1) 내부 인증. INTERNAL_TOKEN 이 없으면 아무 요청도 받지 않는다(fail-closed).
    const std::string configured = internalToken();
    const std::string presented = req->getHeader(kInternalTokenHeader);
    if (configured.empty() || presented.empty() || !constantTimeEquals(configured, presented)) {
        LOG_WARN << "collab 티켓 소비 거부: 내부 토큰이 설정되지 않았거나 일치하지 않습니다.";
        callback(errorResponse("401", "내부 인증에 실패했습니다.", k401Unauthorized));
        return;
    }

    auto jsonPtr = req->getJsonObject();
    if (!jsonPtr || !validateStrings(jsonPtr, "ticket")) {
        callback(errorResponse("400", "필수 파라미터(ticket)가 누락되었습니다.", k400BadRequest));
        return;
    }

    // 2) 티켓 소비(1회용). 만료·이미 사용·위조를 구분해 알려 주지 않는다.
    CollabTicket ticket;
    if (!TicketStore::instance().consume((*jsonPtr)["ticket"].asString(), ticket)) {
        callback(errorResponse("P0901", "티켓이 만료되었거나 이미 사용되었습니다.", k401Unauthorized));
        return;
    }

    // 3) collab 이 세션을 바인딩할 수 있는 최소 정보만 준다(토큰·비밀 값은 넣지 않는다).
    Json::Value item;
    item["user_email"] = ticket.userEmail;
    item["user_name"] = ticket.userName;
    item["repo_id"] = ticket.repoId;
    item["node_id"] = ticket.nodeId;
    item["can_write"] = ticket.canWrite;
    callback(successResponse(singleItemArray(item), "티켓을 확인했습니다."));
}