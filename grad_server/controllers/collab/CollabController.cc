#include "CollabController.h"
#include "GithubWebSocketController.h"
#include "ResponseUtils.h"
#include "ValidationUtils.h"

#include <drogon/drogon.h>
#include <drogon/utils/Utilities.h>
#include <json/json.h>

#include <chrono>
#include <cctype>
#include <ctime>
#include <cstdlib>
#include <filesystem>
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
// 경로 유틸 (§9.4 / §13.3.1)
// ---------------------------------------------------------------------------

// 서버 CWD 기준 저장소 경로의 접두사. DB 가 만드는 local_path 는 항상 이 값으로 시작한다.
constexpr char kRepositoryPrefix[] = "repository/";
constexpr std::size_t kRepositoryPrefixLen = sizeof(kRepositoryPrefix) - 1;

// DB 의 CWD 기준 경로("repository/<node>/<repo>[.worktrees/<slug>]")를
// 볼륨 루트 기준 상대 경로("<node>/<repo>[.worktrees/<slug>]")로 바꾼다.
//
// collab 컨테이너는 같은 물리 볼륨을 REPO_ROOT 로 마운트한다. 두 컨테이너가 같은 파일을
// 가리키려면 절대 경로가 아니라 "볼륨 루트 기준" 상대 경로로 넘겨야 한다. 접두사가 없거나
// 상위 탈출("..")·역슬래시가 섞여 있으면 false 를 돌려주고 호출자가 거부한다.
bool toVolumeRelative(const std::string &dbPath, std::string &out) {
    if (dbPath.compare(0, kRepositoryPrefixLen, kRepositoryPrefix) != 0) {
        return false;
    }
    const std::string rest = dbPath.substr(kRepositoryPrefixLen);
    if (rest.empty() || rest.front() == '/' || rest.find("..") != std::string::npos ||
        rest.find('\\') != std::string::npos) {
        return false;
    }
    out = rest;
    return true;
}

// 작업 디렉터리가 실제로 준비됐는지 확인한다. 없으면 collab 이 flush 할 곳이 없다.
bool directoryReady(const std::string &cwdRelativePath) {
    std::error_code ec;
    const auto absolute = std::filesystem::absolute(cwdRelativePath, ec);
    if (ec) {
        return false;
    }
    return std::filesystem::is_directory(absolute, ec);
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
// ===========================================================================
// collab → C++ : 브랜치 작업 디렉터리 해석 (내부 전용, §9.4 / §13.3.1)
// ===========================================================================

// collab 은 DB 도 git 도 모른다. 문서 소켓이 방에 들어갈 때 이 API 로 (저장소, 브랜치)의
// 작업 디렉터리와 `.ydoc` 영속화 디렉터리를 물어본다. 경로의 진실은 DB 한 곳에 두고,
// 여기서는 형태(접두사·상위 탈출)와 "실제로 존재하는가"만 검증해 볼륨 상대 경로로 바꿔 준다.
void CollabController::resolvePath(const HttpRequestPtr &req,
                                   std::function<void(const HttpResponsePtr &)> &&callback) {
    // 1) 내부 인증 — 티켓 소비와 같은 규칙(fail-closed).
    const std::string configured = internalToken();
    const std::string presented = req->getHeader(kInternalTokenHeader);
    if (configured.empty() || presented.empty() || !constantTimeEquals(configured, presented)) {
        LOG_WARN << "collab 경로 해석 거부: 내부 토큰이 설정되지 않았거나 일치하지 않습니다.";
        callback(errorResponse("401", "내부 인증에 실패했습니다.", k401Unauthorized));
        return;
    }

    auto jsonPtr = req->getJsonObject();
    if (!jsonPtr || !validateInts(jsonPtr, "repo_id") || !validateStrings(jsonPtr, "branch")) {
        callback(errorResponse("400", "필수 파라미터(repo_id, branch)가 누락되었습니다.", k400BadRequest));
        return;
    }

    const int repoId = (*jsonPtr)["repo_id"].asInt();
    const std::string branch = (*jsonPtr)["branch"].asString();

    runOffLoop(std::move(callback), [repoId, branch]() -> HttpResponsePtr {
        auto db = app().getDbClient();

        // 2) 저장소 + 브랜치를 한 번에 읽는다. 기본 브랜치도 github_branches 행이 있으므로
        //    (create_github_repository 가 등록해 둔다) 여기서 함께 조회된다.
        //    행이 없으면 "등록되지 않은 브랜치"이고 collab 은 그 브랜치를 열 수 없다.
        auto rows = db->execSqlSync(
            "SELECT r.node_id, r.local_path, r.default_branch, b.worktree_path, "
            "       github_branch_slug(b.name) AS branch_slug "
            "FROM github_repositories r "
            "JOIN github_branches b ON b.repo_id = r.repo_id "
            "  AND b.name = $2 AND b.is_deleted = FALSE "
            "WHERE r.repo_id = $1 AND r.is_deleted = FALSE",
            repoId, branch);
        if (rows.empty()) {
            return errorResponse("P0801", "등록되지 않은 저장소 또는 브랜치입니다: " + branch, k404NotFound);
        }

        const auto &row = rows[0];
        const std::string localPath = row["local_path"].as<std::string>();
        const std::string defaultBranch = row["default_branch"].as<std::string>();
        const std::string worktreePath = row["worktree_path"].as<std::string>();
        const std::string branchSlug = row["branch_slug"].as<std::string>();
        const int nodeId = row["node_id"].as<int>();

        std::string localRel;
        std::string worktreeRel;
        const bool localOk = toVolumeRelative(localPath, localRel);
        const bool worktreeOk = toVolumeRelative(worktreePath, worktreeRel);
        if (!localOk || !worktreeOk || branchSlug.empty()) {
            LOG_ERROR << "저장소 경로 형태가 예상과 다릅니다. repo=" << repoId
                      << " local=" << localPath << " worktree=" << worktreePath;
            return errorResponse("P0807", "저장소 경로 정보가 올바르지 않습니다.", k500InternalServerError);
        }

        // 3) DB 불변식을 한 번 더 확인한다. 기본 브랜치는 clone 디렉터리 자체가 작업 트리이고,
        //    나머지는 `.worktrees/<slug>` 를 쓴다(§2.3). 어긋나면 collab 에 엉뚱한 경로를 주게 된다.
        const bool isDefault = (branch == defaultBranch);
        if (isDefault) {
            if (worktreePath != localPath) {
                LOG_ERROR << "기본 브랜치 worktree 경로 불일치. repo=" << repoId
                          << " local=" << localPath << " worktree=" << worktreePath;
                return errorResponse("P0807", "저장소 경로 정보가 올바르지 않습니다.", k500InternalServerError);
            }
        } else if (worktreePath != localPath + ".worktrees/" + branchSlug) {
            LOG_ERROR << "브랜치 worktree 경로 불일치. repo=" << repoId << " branch=" << branch
                      << " worktree=" << worktreePath;
            return errorResponse("P0807", "저장소 경로 정보가 올바르지 않습니다.", k500InternalServerError);
        }

        // 4) 작업 디렉터리가 실제로 있어야 collab 이 파일을 읽고 flush 할 수 있다.
        //    트리 조회가 먼저 돌면서 worktree 를 만들어 두지만, 없으면 원인을 분명히 알려 준다.
        //    (GithubController 의 같은 실패 경로와 동일하게 P0807 + 500 을 쓴다)
        if (!directoryReady(worktreePath)) {
            return errorResponse("P0807", "브랜치 작업 디렉터리가 준비되지 않았습니다: " + branch,
                                 k500InternalServerError);
        }

        // 5) 볼륨 상대 경로로 돌려준다. collab 은 REPO_ROOT 만 붙여 그대로 쓴다.
        Json::Value item;
        item["repo_id"] = repoId;
        item["node_id"] = nodeId;
        item["branch"] = branch;
        item["default_branch"] = defaultBranch;
        item["is_default"] = isDefault;
        item["worktree_rel"] = worktreeRel;
        item["collab_rel"] = localRel + ".collab/" + branchSlug;
        return successResponse(singleItemArray(item), "브랜치 작업 디렉터리를 확인했습니다.");
    });
}

// ===========================================================================
// collab → C++ : worktree 변경 알림 (내부 전용, §9.9 / §15.10)
// ===========================================================================

// collab 이 worktree 파일을 실제로 내려쓴 직후 부른다. 여기서는 그 브랜치 방의 접속자에게
// worktree_changed 를 중계하기만 한다 — 같은 브랜치의 Changes 뷰가 즉시 다시 그린다(§15.10).
// flush 는 collab 이 이미 끝냈으므로 DB·git 을 건드리지 않는다(순수 브로드캐스트).
// 아무도 듣고 있지 않으면 중계는 no-op 이지만 실패는 아니다.
void CollabController::notifyWorktreeChanged(const HttpRequestPtr &req,
                                             std::function<void(const HttpResponsePtr &)> &&callback) {
    // 1) 내부 인증 — 다른 /internal/collab/* 와 같은 규칙(fail-closed).
    const std::string configured = internalToken();
    const std::string presented = req->getHeader(kInternalTokenHeader);
    if (configured.empty() || presented.empty() || !constantTimeEquals(configured, presented)) {
        LOG_WARN << "worktree 변경 알림 거부: 내부 토큰이 설정되지 않았거나 일치하지 않습니다.";
        callback(errorResponse("401", "내부 인증에 실패했습니다.", k401Unauthorized));
        return;
    }

    auto jsonPtr = req->getJsonObject();
    if (!jsonPtr || !validateInts(jsonPtr, "repo_id") || !validateStrings(jsonPtr, "branch")) {
        callback(errorResponse("400", "필수 파라미터(repo_id, branch)가 누락되었습니다.", k400BadRequest));
        return;
    }

    const int repoId = (*jsonPtr)["repo_id"].asInt();
    const std::string branch = (*jsonPtr)["branch"].asString();

    // 2) paths 는 안내용 목록이다(확장은 전체 status 를 다시 받는다). 문자열만 골라 담는다.
    Json::Value paths(Json::arrayValue);
    const Json::Value &rawPaths = (*jsonPtr)["paths"];
    if (rawPaths.isArray()) {
        for (const auto &path : rawPaths) {
            if (path.isString()) {
                paths.append(path.asString());
            }
        }
    }

    // 3) 그 브랜치 방의 접속자에게 중계한다.
    Json::Value event;
    event["type"] = "worktree_changed";
    event["repo_id"] = repoId;
    event["branch"] = branch;
    event["paths"] = paths;
    GithubWebSocketController::broadcastToBranch(repoId, branch, event);

    Json::Value item;
    item["repo_id"] = repoId;
    item["branch"] = branch;
    item["notified"] = static_cast<Json::Int>(paths.size());
    callback(successResponse(singleItemArray(item), "worktree 변경을 알렸습니다."));
}