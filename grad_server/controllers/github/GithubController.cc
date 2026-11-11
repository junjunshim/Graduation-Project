#include "GithubController.h"
#include "ResponseUtils.h"
#include "ValidationUtils.h"
#include "GitRunner.h"
#include "GithubWebSocketController.h"
#include "AuthController.h"
#include "CollabClient.h"
#include "WorkerLimiter.h"
#include "NotificationWebSocketController.h"
#include "SecureToken.h"

#include <drogon/HttpClient.h>
#include <json/json.h>
#include <zlib.h>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <ctime>
#include <filesystem>
#include <fstream>
#include <future>
#include <iterator>
#include <map>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <system_error>
#include <vector>

using namespace api;
using namespace drogon;
using namespace app_utils;

namespace {

// 파일 크기 상한. 넘으면 읽기 전용으로만 다룬다.
constexpr long long kMaxTextFileBytes = 512 * 1024;

// 읽기 전용 열람 상한. 동시 편집은 못 해도 내용은 볼 수 있게 하는 한계다.
// collab 의 MAX_READONLY_BYTES 와 같은 값이어야 두 경로(편집·diff)가 같은 파일에서 같은 판단을 한다.
constexpr long long kMaxReadOnlyFileBytes = 4 * 1024 * 1024;

// AI 작업공간 스냅샷 상한. 브라우저형 JSON 응답 하나로 옮기므로 파일 수·개별 크기·전체 크기를 모두 제한한다.
// AI 작업공간 파일 하나의 상한은 실시간 편집 상한과 같게 둔다. 그래야 AI 가 스냅샷에서 받은 파일을
// 512KB 넘게 키워 쓰다가 Yjs 문서와 어긋나는 경우를 만들지 않는다.
constexpr long long kMaxAiWorkspaceFileBytes = kMaxTextFileBytes;
constexpr long long kMaxAiWorkspaceTotalBytes = 24 * 1024 * 1024;
constexpr int kMaxAiWorkspaceFiles = 5000;

// MCP diff 응답 상한. 큰 diff 가 WebSocket·JSON 응답을 밀어내지 않게 한다.
constexpr long long kMaxPatchBytes = 512 * 1024;

// GitHub 연동 권한 비트. 조회는 GITHUB_VIEW(bit 22), 저장소 추가/해제는 GITHUB_REPO_MANAGE(bit 24) 로 SQL 함수가 판정하고,
// worktree 편집(브랜치 생성·삭제, 커밋, push, 파일 조작)은 GITHUB_CHANGE(bit 23) 로 여기서 한 번 더 막는다.
// 응답 헬퍼

HttpResponsePtr makeJsonResponse(const Json::Value &body, HttpStatusCode code) {
    auto resp = HttpResponse::newHttpJsonResponse(body);
    resp->setStatusCode(code);
    return resp;
}

// 성공 응답 규격: {status, data[], message}
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

// C++ 가 직접 판정한 오류. DB 함수가 던진 오류는 아래 dbErrorResponse 가 처리한다.
HttpResponsePtr errorResponse(const std::string &code, const std::string &message,
                              HttpStatusCode httpCode, const Json::Value &data = Json::Value()) {
    Json::Value ret;
    ret["status"] = "error";
    ret["code"] = code;
    ret["message"] = message;
    if (!data.isNull()) {
        ret["data"] = data;
    }
    return makeJsonResponse(ret, httpCode);
}

// DB 오류를 기존 컨트롤러와 같은 규격({status, code, message})으로 변환한다.
HttpResponsePtr dbErrorResponse(const orm::DrogonDbException &e, const std::string &requestId) {
    Json::Value ret = parseDbError(e, requestId);
    auto httpCode = static_cast<HttpStatusCode>(ret["http_code"].asInt());
    ret.removeMember("http_code");
    return makeJsonResponse(ret, httpCode);
}

// 값 변환 / 문자열 헬퍼

Json::Value rowsToArray(const orm::Result &result) {
    return parseIntegratedDataResult(result)["data"];
}

// 응답 규격은 항상 {status, data[], message} 다. 결과가 1건뿐인 API(파일 조회 등)는
// 객체를 그대로 넣지 말고 이 배열로 감싼다 — 그러지 않으면 클라이언트 파서가 data 를 배열로 요구해 실패한다.
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

std::string trim(const std::string &s) {
    const auto begin = s.find_first_not_of(" \t\r\n");
    if (begin == std::string::npos) {
        return "";
    }
    const auto end = s.find_last_not_of(" \t\r\n");
    return s.substr(begin, end - begin + 1);
}

std::string lowerCopy(std::string s) {
    std::transform(s.begin(), s.end(), s.begin(),
                   [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
    return s;
}

bool parseInt(const std::string &raw, int &out) {
    if (raw.empty()) {
        return false;
    }
    try {
        std::size_t pos = 0;
        const int value = std::stoi(raw, &pos);
        if (pos != raw.size()) {
            return false;
        }
        out = value;
        return true;
    } catch (const std::exception &) {
        return false;
    }
}

std::vector<std::string> splitLines(const std::string &text) {
    std::vector<std::string> lines;
    std::istringstream stream(text);
    std::string line;
    while (std::getline(stream, line)) {
        if (!line.empty() && line.back() == '\r') {
            line.pop_back();
        }
        if (!line.empty()) {
            lines.push_back(line);
        }
    }
    return lines;
}

// git -z 출력(NUL 구분)을 항목 목록으로 나눈다.
std::vector<std::string> splitNul(const std::string &text) {
    std::vector<std::string> items;
    std::size_t start = 0;
    while (start < text.size()) {
        const std::size_t end = text.find('\0', start);
        if (end == std::string::npos) {
            items.push_back(text.substr(start));
            break;
        }
        if (end > start) {
            items.push_back(text.substr(start, end - start));
        }
        start = end + 1;
    }
    return items;
}

// git log 의 US(필드)·RS(레코드) 구분자. 커밋 제목에 어떤 문자가 와도 파싱이 깨지지 않게 쓴다.
constexpr char kFieldSeparator = '\x1f';
constexpr char kRecordSeparator = '\x1e';

// 구분자 한 글자로 나눈다. 빈 조각도 그대로 남긴다(git 출력은 위치로 필드를 구분한다).
std::vector<std::string> splitBy(const std::string &text, char separator) {
    std::vector<std::string> items;
    std::size_t start = 0;
    while (true) {
        const std::size_t end = text.find(separator, start);
        if (end == std::string::npos) {
            items.push_back(text.substr(start));
            break;
        }
        items.push_back(text.substr(start, end - start));
        start = end + 1;
    }
    return items;
}

std::string normalizePath(std::string path) {
    while (!path.empty() && path.front() == '/') {
        path.erase(path.begin());
    }
    while (!path.empty() && path.back() == '/') {
        path.pop_back();
    }
    return path;
}

// '<ref>:<path>' treeish. path 가 비면 ref 자체를 가리킨다 (브랜치 이름의 '/' 와 섞이지 않는다).
std::string treeishOf(const std::string &ref, const std::string &path) {
    const std::string clean = normalizePath(path);
    return clean.empty() ? ref : (ref + ":" + clean);
}

// 브랜치 이름을 clone 안에 실제로 존재하는 tree-ish 로 해석한다.
// clone 은 기본 브랜치만 로컬 브랜치로 만들기 때문에, 등록하지 않은 브랜치는
// 원격 추적 참조(origin/<name>)로만 있다. 그대로 쓰면 "fatal: Not a valid object name" 이다.
// 로컬 브랜치가 있으면 그것을 쓴다(worktree 에 쌓인 로컬 커밋까지 보여야 하므로).
// 둘 다 없으면 빈 문자열을 돌려준다.
std::string resolveTreeish(const std::string &localPath, const std::string &branch) {
    if (branch.empty()) {
        return "";
    }

    if (GitRunner::run(localPath, {"show-ref", "--verify", "--quiet", "refs/heads/" + branch}).ok()) {
        return branch;
    }

    if (GitRunner::run(localPath, {"show-ref", "--verify", "--quiet", "refs/remotes/origin/" + branch}).ok()) {
        return "origin/" + branch;
    }

    return "";
}

// 임의 rev 검증. <sha>, origin/<branch>, HEAD, <sha>^ 처럼
// 브랜치 이름으로 해석되지 않는 참조도 받는다. argv 로 그대로 넘어가므로 셸은 거치지 않지만,
// git 옵션으로 오인될 수 있는 선행 '-' 와 tree-ish 구분자 ':' 는 허용 목록에서 뺀다.
bool isValidRev(const std::string &rev) {
    if (rev.empty() || rev.compare(0, 1, "-") == 0) {
        return false;
    }

    const std::string allowed = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._/~^";
    return rev.find_first_not_of(allowed) == std::string::npos;
}

// rev 를 clone 안에서 실제로 존재하는 tree-ish 로 확정한다. 성공하면 확정된 rev, 실패하면 빈 문자열.
// 브랜치 이름은 로컬 브랜치일 수도(작업 트리 커밋) 원격 추적 참조일 수도 있어 순서대로 시도한다.
std::string resolveRev(const std::string &localPath, const std::string &rev) {
    if (!isValidRev(rev)) {
        return "";
    }

    if (GitRunner::resolveRef(localPath, rev).ok()) {
        return rev;
    }

    // 로컬 브랜치로 없으면 원격 추적 참조(origin/<rev>)까지 본다 — resolveTreeish 가 그 규칙을 안다.
    const std::string treeish = resolveTreeish(localPath, rev);
    if (!treeish.empty() && GitRunner::resolveRef(localPath, treeish).ok()) {
        return treeish;
    }

    return "";
}

// 부모 없는 첫 커밋(root)을 비교할 때 쓰는 빈 트리. git 이 모든 저장소에서 같은 해시를 쓴다.
constexpr char kEmptyTreeSha[] = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

// 환경/설정

// 자격증명 암호화 키는 환경변수에서만 읽는다. 없으면 자격증명을 저장하지 않는다 (fail-closed).
std::string credentialKey() {
    const char *value = std::getenv("GITHUB_TOKEN_KEY");
    return (value != nullptr) ? std::string(value) : std::string();
}

// 확장에 알려 줄 액세스 토큰 수명(초). AuthController::generateToken 이 쓰는 설정과 같은 값이다.
int accessTokenExpirySeconds() {
    return app().getCustomConfig()["access_token_expiry"].asInt();
}

// clone 경로는 repository/<node_id>/<repo_name>.
// data/03_func_github.sql 의 create_github_repository 와 같은 식이어야 한다.
std::string localPathFor(int nodeId, const std::string &repoName) {
    return "repository/" + std::to_string(nodeId) + "/" + repoName;
}

std::string utcTimestampNow() {
    const std::time_t now = std::chrono::system_clock::to_time_t(std::chrono::system_clock::now());
    std::tm utc{};
    gmtime_r(&now, &utc);
    char buffer[32] = {};
    std::strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &utc);
    return buffer;
}

// GitHub 작업 성공을 GITHUB_VIEW 보유자에게만 알린다. 알람 발행 실패는 원래 작업의 성공을
// 뒤집지 않는다. 수신자 계산과 표시 문구 원본은 클라이언트가 아니라 이 payload 가 기준이다.
void notifyGithubEvent(const orm::DbClientPtr &db,
                       int nodeId,
                       int repoId,
                       const std::string &repoFullName,
                       const std::string &actorEmail,
                       const std::string &entityType,
                       const std::string &entityId,
                       const std::string &action,
                       const std::string &branch = "",
                       const std::string &commitSha = "",
                       const std::string &commitMessage = "",
                       int pushedCommitCount = -1) {
    try {
        std::string actorName = actorEmail;
        Json::Value userRow;
        if (singleRow(db->execSqlSync("SELECT * FROM get_user_profile($1, $2)", actorEmail, actorEmail),
                      userRow)) {
            actorName = userRow["name"].asString();
        }

        auto recipients = db->execSqlSync(
            "SELECT email FROM get_github_notification_recipients_by_node($1, $2)",
            nodeId, actorEmail);
        if (recipients.empty()) {
            return;
        }

        const std::string createdAt = utcTimestampNow();
        Json::Value event;
        event["type"] = "NOTIFICATION";
        event["sub_type"] = "GITHUB";

        Json::Value &data = event["data"];
        data["notification_key"] = "github:" + std::to_string(repoId) + ":" + entityType + ":" +
                                   action + ":" + entityId + ":" + createdAt;
        data["entity_type"] = entityType;
        data["entity_id"] = entityId;
        data["action"] = action;
        data["node_id"] = nodeId;
        data["repo_id"] = repoId;
        data["repo_full_name"] = repoFullName;
        data["actor_user_id"] = actorEmail;
        data["actor_name"] = actorName;
        data["title"] = "GitHub 알림";
        data["content"] = commitMessage;
        data["link_url"] = "/workspace?nodeId=" + std::to_string(nodeId) + "&view=github";
        data["is_read"] = false;
        data["created_at"] = createdAt;
        data["can_view_detail"] = true;

        if (!branch.empty()) {
            data["branch"] = branch;
        }
        if (!commitSha.empty()) {
            data["commit_sha"] = commitSha;
        }
        if (!commitMessage.empty()) {
            data["commit_message"] = commitMessage;
        }
        if (pushedCommitCount >= 0) {
            data["pushed_commit_count"] = pushedCommitCount;
        }

        Json::StreamWriterBuilder writer;
        const std::string message = Json::writeString(writer, event);
        std::vector<std::string> emails;
        emails.reserve(recipients.size());
        for (const auto &row : recipients) {
            const std::string email = row["email"].as<std::string>();
            if (!email.empty()) {
                emails.push_back(email);
            }
        }

        if (!emails.empty()) {
            app().getLoop()->queueInLoop([emails, message]() {
                for (const auto &email : emails) {
                    NotificationWebSocketController::sendNotificationToUser(email, message);
                }
            });
        }
    } catch (const std::exception &e) {
        LOG_WARN << "GitHub 알람 발행 실패 (repo=" << repoId << ", type=" << entityType
                 << "): " << e.what();
    }
}

// 활성 자격증명의 복호화된 토큰. 없거나 키가 없으면 빈 문자열(P0802/P0806 은 "없음"으로 취급).
std::string userToken(const orm::DbClientPtr &db, const std::string &email) {
    const std::string key = credentialKey();
    if (key.empty()) {
        return "";
    }
    try {
        // 자격증명이 없는 것은 정상 상태(익명 clone)다. 먼저 존재를 확인해 예외(P0802)로
        // PostgreSQL 로그를 채우지 않는다. 실제로 문제인 경우(복호화 실패 등)만 예외가 난다.
        Json::Value status;
        if (!singleRow(db->execSqlSync("SELECT * FROM get_github_user_credential($1)", email), status)) {
            return "";
        }
        const Json::Value hasCredential = status["has_credential"];
        if (!hasCredential.isBool() || !hasCredential.asBool()) {
            return "";
        }

        auto result = db->execSqlSync("SELECT get_github_user_token($1, $2) AS token", email, key);
        if (result.empty()) {
            return "";
        }
        return result[0]["token"].as<std::string>();
    } catch (const orm::DrogonDbException &e) {
        LOG_WARN << "GitHub 토큰 조회를 건너뜁니다: " << e.base().what();
        return "";
    }
}

// JwtFilter 가 넣어 준 로그인 사용자 이메일
std::string requesterEmail(const HttpRequestPtr &req) {
    return req->attributes()->get<std::string>("user_email");
}

// 실행 헬퍼

// clone/fetch 같은 git 실행과 동기 DB 호출은 오래 걸린다.
// 이벤트 루프를 막지 않도록 워커 스레드에서 실행하고, 응답만 원래 루프로 되돌린다.
//
// 동시 실행 수는 WorkerLimiter 가 막는다. 상한이 없으면 요청 수만큼
// git 프로세스가 생겨 메모리가 예측 불가능해지고, DB 커넥션(사설 풀)이 마르면 무관한
// 요청까지 줄을 선다. 원격 작업(clone/fetch/push)은 Lane::Network 로 넘겨 더 좁은 한도를 쓴다.
void runOffLoopImpl(std::function<void(const HttpResponsePtr &)> &&callback,
                    std::function<HttpResponsePtr()> &&work,
                    WorkerLimiter::Lane lane,
                    std::string requestId) {
    auto cb = std::make_shared<std::function<void(const HttpResponsePtr &)>>(std::move(callback));
    auto &limiter = WorkerLimiter::instance();
    auto task = [cb, work = std::move(work), lane, requestId, &limiter]() {
        HttpResponsePtr resp;

        if (!limiter.acquire(lane)) {
            // 동시 실행 상한과 대기 줄 상한을 모두 넘었다. 더 기다리게 하면 그 대기가
            // 곧 스레드 쌓기라, 즉시 거부하고 클라이언트가 다시 시도하게 한다.
            LOG_WARN << "[GITHUB] event=worker.limit " << app_utils::requestIdTag(requestId)
                     << " running=" << limiter.running()
                     << " network=" << limiter.networkRunning()
                     << " waiting=" << limiter.waiting();
            resp = errorResponse("503",
                                 "서버가 동시에 처리할 수 있는 작업 수를 넘었습니다. 잠시 뒤 다시 시도해 주세요.",
                                 k503ServiceUnavailable);
            resp->addHeader("Retry-After", "5");
        } else {
            try {
                resp = work();
            } catch (const orm::DrogonDbException &e) {
                resp = dbErrorResponse(e, requestId);
            } catch (const std::exception &e) {
                LOG_ERROR << "[GITHUB] event=handler.failed " << app_utils::requestIdTag(requestId)
                          << " error=" << app_utils::sanitizeLogValue(e.what(), 1024);
                resp = errorResponse("500", "서버 처리 중 오류가 발생했습니다.", k500InternalServerError);
            }
            // 위 catch 가 모든 예외를 삼키므로 여기까지 반드시 온다 — 슬롯이 새지 않는다.
            limiter.release(lane);
        }

        app().getLoop()->queueInLoop([cb, resp]() { (*cb)(resp); });
    };

    if (!limiter.submit(lane, std::move(task))) {
        LOG_WARN << "[GITHUB] event=worker.limit " << app_utils::requestIdTag(requestId)
                 << " running=" << limiter.running()
                 << " network=" << limiter.networkRunning()
                 << " waiting=" << limiter.waiting();
        auto resp = errorResponse("503",
                                  "서버가 동시에 처리할 수 있는 작업 수를 넘었습니다. 잠시 후 다시 시도해 주세요.",
                                  k503ServiceUnavailable);
        resp->addHeader("Retry-After", "5");
        app().getLoop()->queueInLoop([cb, resp]() { (*cb)(resp); });
    }
}

void runOffLoop(std::function<void(const HttpResponsePtr &)> &&callback,
                std::function<HttpResponsePtr()> &&work,
                WorkerLimiter::Lane lane = WorkerLimiter::Lane::Normal) {
    runOffLoopImpl(std::move(callback), std::move(work), lane, std::string());
}

void runOffLoop(const HttpRequestPtr &req,
                std::function<void(const HttpResponsePtr &)> &&callback,
                std::function<HttpResponsePtr()> &&work,
                WorkerLimiter::Lane lane = WorkerLimiter::Lane::Normal) {
    runOffLoopImpl(std::move(callback), std::move(work), lane, app_utils::requestIdOf(req));
}

// 원격 작업(clone / fetch / push) 전용 입구. 타임아웃이 분 단위라 더 좁은 차선을 쓴다.
void runNetworkOffLoop(std::function<void(const HttpResponsePtr &)> &&callback,
                       std::function<HttpResponsePtr()> &&work) {
    runOffLoopImpl(std::move(callback), std::move(work), WorkerLimiter::Lane::Network, std::string());
}

void runNetworkOffLoop(const HttpRequestPtr &req,
                       std::function<void(const HttpResponsePtr &)> &&callback,
                       std::function<HttpResponsePtr()> &&work) {
    runOffLoopImpl(std::move(callback), std::move(work), WorkerLimiter::Lane::Network,
                   app_utils::requestIdOf(req));
}

// 작업 트리 헬퍼 (브랜치 격리 = git worktree)

// git worktree 는 작업 디렉터리에 '.git' 파일을 만든다. 그것으로 준비 여부를 판단한다.
// DB 의 worktree_path 는 서버 프로세스 CWD 기준 상대 경로이고, git 에는 같은 값을 절대 경로로
// 바꿔 넘기므로(GitRunner::worktreeAdd) 두 기준이 일치한다. 여기서도 같은 기준으로 맞춘다.
bool worktreeReady(const std::string &worktreePath) {
    if (worktreePath.empty()) {
        return false;
    }
    std::error_code ec;
    const auto root = std::filesystem::absolute(worktreePath, ec);
    if (ec) {
        return false;
    }
    return std::filesystem::exists(root / ".git", ec);
}

// git 이 기억하는 worktree 중 해당 로컬 브랜치를 checkout 하고 있는 경로를 찾는다.
//   git worktree list --porcelain 은 빈 줄로 구분된 블록을 내놓고, 블록마다
//   "worktree <절대 경로>" 와 "branch refs/heads/<브랜치>" 줄이 들어간다.
// DB 의 worktree_path 와 어긋난 worktree(과거 상대 경로 버그로 저장소 안쪽에 만들어진 것)를
// 찾아내는 용도다. 찾으면 outPath 에 절대 경로를 담고 true 를 돌려준다.
bool findWorktreeForBranch(const std::string &repoDir, const std::string &branch, std::string &outPath) {
    auto listed = GitRunner::worktreeList(repoDir);
    if (!listed.ok()) {
        return false;
    }

    const std::string wanted = "branch refs/heads/" + branch;
    std::string current;
    std::istringstream stream(listed.out);
    std::string line;
    while (std::getline(stream, line)) {
        line = trim(line);
        if (line.rfind("worktree ", 0) == 0) {
            current = trim(line.substr(std::string("worktree ").size()));
            continue;
        }
        if (line == wanted) {
            if (current.empty()) {
                return false;
            }
            outPath = current;
            return true;
        }
    }
    return false;
}

// 잔여 디렉터리를 치운다. 회수·실패한 flush·손으로 지운 .git 파일 같은 이유로 worktree 자리에
// git 이 모르는 디렉터리가 남아 있으면 git worktree add 가 "already exists" 로, 등록 정보만 .git 안에
// 남아 있으면 "missing but already registered" 로 거부한다. 두 경우를 여기서 함께 정리한다.
void clearStaleWorktreeDir(const std::string &repoDir, const std::string &worktreePath) {
    std::error_code ec;
    if (!std::filesystem::exists(worktreePath, ec) || ec) {
        return;   // 자리가 비어 있으면 git 이 그대로 만든다
    }

    LOG_WARN << "worktree 자리에 잔여 디렉터리가 있어 치웁니다: " << worktreePath;
    std::filesystem::remove_all(worktreePath, ec);
    if (ec) {
        LOG_WARN << "잔여 디렉터리를 지우지 못했습니다: " << worktreePath << " (" << ec.message() << ")";
        return;
    }

    // 지워진 worktree 의 등록 정보가 .git 안에 남으면 다음 add 가 거부한다.
    auto pruned = GitRunner::run(repoDir, {"worktree", "prune"});
    if (!pruned.ok()) {
        LOG_WARN << "worktree prune 실패 (" << repoDir << "): " << trim(pruned.err);
    }
}

// 브랜치의 작업 디렉터리를 준비한다(이미 있으면 그대로 쓴다). 로컬에 브랜치가 있으면 그대로 붙이고,
// 원격에만 있으면 origin/<branch> 에서 추적 브랜치를 만들어 붙이며, 둘 다 없으면 기준 브랜치에서
// 새로 만든다.
GitResult ensureWorktree(const std::string &localPath, const std::string &worktreePath,
                         const std::string &branch, const std::string &baseBranch,
                         const GitRunner::Auth *auth) {
    if (worktreeReady(worktreePath)) {
        GitResult ready;
        ready.exitCode = 0;
        return ready;
    }

    // 회수나 실패한 flush 로 그 자리에 남은 잔여 디렉터리를 치우고 git 등록 정보도 맞춘다.
    clearStaleWorktreeDir(localPath, worktreePath);

    const auto hasLocal = [&]() {
        return GitRunner::run(localPath, {"show-ref", "--verify", "--quiet", "refs/heads/" + branch}).ok();
    };
    const auto hasRemote = [&]() {
        return GitRunner::run(localPath, {"show-ref", "--verify", "--quiet", "refs/remotes/origin/" + branch}).ok();
    };

    // 이미 있는 ref 로 worktree 를 만들 수 있으면 원격을 건드리지 않는다. 회수된 브랜치를 다시
    // 여는 흔한 경로가 매번 네트워크 fetch 를 하면 Normal 차선이 원격 지연에 묶인다.
    // 둘 다 없을 때만(새 원격 브랜치·기준 커밋) 원격을 최신화한다.
    bool localExists = hasLocal();
    bool remoteExists = hasRemote();
    if (!localExists && !remoteExists) {
        auto fetched = GitRunner::fetchAll(localPath, auth);
        if (!fetched.ok()) {
            LOG_WARN << "worktree 준비 전 fetch 실패 (" << branch << "): " << trim(fetched.err);
        }
        localExists = hasLocal();
        remoteExists = hasRemote();
    }

    if (localExists) {
        return GitRunner::worktreeAdd(localPath, worktreePath, branch);
    }
    if (remoteExists) {
        return GitRunner::worktreeAdd(localPath, worktreePath, branch, "origin/" + branch);
    }
    return GitRunner::worktreeAdd(localPath, worktreePath, branch, baseBranch.empty() ? "HEAD" : baseBranch);
}

// 저장소가 연결된 노드에 대한 GITHUB_CHANGE(bit 23) 권한을 확인한다.
// 통과하면 true, 아니면 outError 에 응답을 담고 false 를 돌려준다.
bool requireGithubChange(const std::string &requester, int nodeId, HttpResponsePtr &outError) {
    Json::Value auth;
    if (!singleRow(app().getDbClient()->execSqlSync(
                       "SELECT * FROM get_github_change_authority($1, $2)",
                       requester, nodeId),
                   auth)) {
        outError = errorResponse("P0001", "요청자 계정을 찾을 수 없습니다.", k401Unauthorized);
        return false;
    }
    if (!auth["can_write"].as<bool>()) {
        outError = errorResponse("P0103", "저장소 편집 권한(GITHUB_CHANGE)이 없습니다.", k403Forbidden);
        return false;
    }
    return true;
}

// 이미 조회한 저장소 정보를 재사용해 작업 디렉터리를 확정한다.
// 호출부가 get_github_repository_by_id 로 권한을 확인한 경우 같은 쿼리를 반복하지 않는다.
bool resolveWorkDir(const std::string &requester, const Json::Value &repoRow,
                    const std::string &requestedBranch, std::string &outWorkDir,
                    HttpResponsePtr &outError, bool forWrite = false) {
    auto db = app().getDbClient();

    // 편집 계열이면 저장소가 연결된 노드의 GITHUB_CHANGE 권한을 한 번 더 본다.
    if (forWrite && !requireGithubChange(requester, repoRow["node_id"].asInt(), outError)) {
        return false;
    }

    const int repoId = repoRow["repo_id"].asInt();
    const std::string localPath = repoRow["local_path"].asString();
    const std::string defaultBranch = repoRow["default_branch"].asString();
    const std::string branch = requestedBranch.empty() ? defaultBranch : requestedBranch;

    if (branch == defaultBranch) {
        outWorkDir = localPath;
        return true;
    }

    // 등록된 브랜치 한 건만 읽는다. 전체 브랜치와 접속자(presence)를 매번 조립하는
    // get_github_branches 호출은 작업 디렉터리 해석에 필요하지 않다.
    Json::Value branchRow;
    if (!singleRow(db->execSqlSync(
                       "SELECT * FROM get_github_branch_worktree($1, $2)",
                       repoId, branch),
                   branchRow)) {
        outError = errorResponse("P0801", "등록되지 않은 브랜치입니다: " + branch, k404NotFound);
        return false;
    }

    const std::string worktreePath = branchRow["worktree_path"].asString();
    if (worktreePath.empty()) {
        outError = errorResponse("P0807", "브랜치 작업 디렉터리 정보가 없습니다: " + branch,
                                 k500InternalServerError);
        return false;
    }

    // worktree 가 이미 준비되어 있으면 PAT 조회와 원격 fetch 를 모두 건너뛴다.
    if (!worktreeReady(worktreePath)) {
        GitRunner::Auth auth;
        const GitRunner::Auth *authPtr = nullptr;
        const std::string token = userToken(db, requester);
        if (!token.empty()) {
            auth.login = "x-access-token";
            auth.token = token;
            authPtr = &auth;
        }

        const auto &baseBranchField = branchRow["base_branch"];
        const std::string baseBranch =
            baseBranchField.isNull() ? std::string() : baseBranchField.as<std::string>();
        auto ready = ensureWorktree(localPath, worktreePath, branch, baseBranch, authPtr);
        if (!ready.ok()) {
            LOG_WARN << "worktree 준비 실패 (" << branch << "): " << trim(ready.err);
            outError = errorResponse("P0807", "브랜치 작업 디렉터리를 준비하지 못했습니다: " + trim(ready.err),
                                     k500InternalServerError);
            return false;
        }
    }

    // 마지막 사용 시각은 10분 단위로만 갱신되지만, 조회·편집 경로마다 한 번씩 기록한다.
    try {
        db->execSqlSync("SELECT touch_github_branch_worktree($1, $2)", repoId, branch);
    } catch (const std::exception &e) {
        LOG_WARN << "worktree 사용 시각 기록 실패 (" << branch << "): " << e.what();
    }

    outWorkDir = worktreePath;
    return true;
}

// 저장소 조회가 필요한 호출부를 위한 기존 진입점. 이미 조회한 호출부는 위 오버로드를 쓴다.
bool resolveWorkDir(const std::string &requester, int repoId, const std::string &requestedBranch,
                    std::string &outWorkDir, HttpResponsePtr &outError, bool forWrite = false) {
    Json::Value repoRow;
    if (!singleRow(app().getDbClient()->execSqlSync(
                       "SELECT * FROM get_github_repository_by_id($1, $2)", requester, repoId),
                   repoRow)) {
        outError = errorResponse("P0801", "연결된 저장소를 찾을 수 없습니다.", k404NotFound);
        return false;
    }
    return resolveWorkDir(requester, repoRow, requestedBranch, outWorkDir, outError, forWrite);
}

// JSON 배열에서 비어 있지 않은 문자열만 순서대로 모은다.
std::vector<std::string> jsonStringArray(const Json::Value &value) {
    std::vector<std::string> items;
    if (!value.isArray()) {
        return items;
    }
    for (const auto &item : value) {
        if (item.isString() && !item.asString().empty()) {
            items.push_back(item.asString());
        }
    }
    return items;
}

// CRLF 를 LF 로만 바꾼다(되돌리기 payload 용). collab 의 Yjs 텍스트는 LF 고정이고 flush 때 원본 EOL 을 복원한다.
std::string toLf(std::string text) {
    std::string out;
    out.reserve(text.size());
    for (std::size_t i = 0; i < text.size(); ++i) {
        if (text[i] == '\r' && i + 1 < text.size() && text[i + 1] == '\n') {
            continue;
        }
        out.push_back(text[i]);
    }
    return out;
}

// porcelain XY 코드를 응답용 상태 문자열로 옮긴다.
bool porcelainState(char code, std::string &state) {
    switch (code) {
        case 'A': state = "added";      return true;
        case 'M': state = "modified";   return true;
        case 'D': state = "deleted";    return true;
        case 'R': state = "renamed";    return true;
        case 'C': state = "copied";     return true;
        case 'T': state = "typechange"; return true;
        case 'U': state = "conflicted"; return true;
        default:  return false;
    }
}

// 'git status --porcelain=v1 --untracked-files=all -z' 결과를
// 확장 SCM 뷰가 그대로 쓰는 [{path, state, staged}] 로 바꾼다.
// X 는 index(staged), Y 는 작업 트리 쪽 변경이라 둘 다 있으면 두 항목으로 나눈다.
Json::Value parseStatusPorcelain(const std::string &text) {
    Json::Value entries(Json::arrayValue);
    const std::vector<std::string> tokens = splitNul(text);

    std::size_t index = 0;
    while (index < tokens.size()) {
        const std::string token = tokens[index++];
        if (token.size() < 3 || token[2] != ' ') {
            continue;
        }
        const std::string xy = token.substr(0, 2);
        const std::string path = token.substr(3);

        // 이름변경/복사는 -z 에서 'XY <to>\0<from>\0' 순서로 온다.
        std::string from;
        if (xy[0] == 'R' || xy[0] == 'C' || xy[1] == 'R' || xy[1] == 'C') {
            if (index < tokens.size()) {
                from = tokens[index++];
            }
        }

        auto append = [&entries, &path](const std::string &state, bool staged, const std::string &origin) {
            Json::Value entry;
            entry["path"] = path;
            entry["state"] = state;
            entry["staged"] = staged;
            if (!origin.empty()) {
                entry["from"] = origin;
            }
            entries.append(entry);
        };

        if (xy == "??") {
            append("untracked", false, "");
            continue;
        }
        if (xy.find('U') != std::string::npos) {
            // 병합 충돌(UU/AA/DD/...)은 한 항목으로만 보여 준다.
            append("conflicted", false, "");
            continue;
        }

        std::string state;
        if (xy[0] != ' ' && porcelainState(xy[0], state)) {
            append(state, true, from);
        }
        if (xy[1] != ' ' && porcelainState(xy[1], state)) {
            append(state, false, from);
        }
    }
    return entries;
}

// 트리 변경 헬퍼의 정의는 파일 뒤쪽에 모아 두었다 — 여기서 먼저 쓰므로 미리 알린다.
Json::Value filterNoiseEntries(const Json::Value &entries, const std::vector<std::string> &noise);
std::vector<std::string> nestedWorktreePaths(const std::string &workDir);

// 작업 트리 상태를 읽는다. 실패하면 out.ok() 가 false 다.
// 저장소 안쪽에 남은 worktree(과거 상대 경로 버그의 흔적)는 그 트리 전체가 untracked 로 보이므로 걸러낸다.
Json::Value readWorktreeStatus(const std::string &workDir, GitResult &out) {
    out = GitRunner::run(workDir, {"status", "--porcelain=v1", "--untracked-files=all", "-z"});
    if (!out.ok()) {
        return Json::Value(Json::arrayValue);
    }
    const Json::Value entries = parseStatusPorcelain(out.out);
    if (entries.empty()) {
        return entries;   // 지울 잡음 항목이 없으므로 worktree list 조회를 생략한다.
    }
    return filterNoiseEntries(entries, nestedWorktreePaths(workDir));
}

// 확장이 실패 사유를 프로그램으로 구분할 수 있게 data 에 reason 만 담는다.
Json::Value reasonData(const std::string &reason) {
    Json::Value data;
    data["reason"] = reason;
    return data;
}

// work_item_id 같은 식별자는 VARCHAR 이지만 숫자로 와도 문자열로 맞춰 준다.
std::string idAsString(const Json::Value &value) {
    if (value.isString()) {
        return value.asString();
    }
    if (value.isInt() || value.isInt64() || value.isUInt() || value.isUInt64()) {
        return std::to_string(value.asInt64());
    }
    return "";
}

// 같은 저장소에서 커밋이 겹치면 git 이 index.lock 으로 실패한다.
// 저장소 단위 뮤텍스를 돌려주어 커밋 구간을 직렬화한다.
std::shared_ptr<std::mutex> repoLock(int repoId) {
    static std::mutex tableGuard;
    static std::map<int, std::shared_ptr<std::mutex>> table;

    std::lock_guard<std::mutex> guard(tableGuard);
    std::shared_ptr<std::mutex> &entry = table[repoId];
    if (!entry) {
        entry = std::make_shared<std::mutex>();
    }
    return entry;
}

// 현재 브랜치가 원격보다 얼마나 앞섰는지/뒤처졌는지 (GET /api/github/repos/sync).
// 커밋과 push 가 분리되어 있어 둘이 같은 계산을 공유한다.
struct SyncState {
    bool hasUpstream = false;   // origin/<branch> 추적 ref 가 있는가
    std::string headSha;        // 로컬 HEAD
    std::string originSha;      // origin/<branch> (없으면 빈 값)
    int ahead = 0;              // push 하면 올라갈 커밋 수
    int behind = 0;             // 원격이 앞선 커밋 수
};

SyncState readSyncState(const std::string &workDir, const std::string &branch) {
    SyncState state;

    if (auto head = GitRunner::headSha(workDir); head.ok()) {
        state.headSha = trim(head.out);
    }

    // 아직 한 번도 push 하지 않은 브랜치는 원격 추적 ref 가 없다. 그때는 전체 커밋을 '올라갈 양' 으로 본다.
    const std::string remoteRef = "origin/" + branch;
    auto origin = GitRunner::resolveRef(workDir, remoteRef);
    if (!origin.ok()) {
        int total = 0;
        if (auto all = GitRunner::revListCount(workDir, "HEAD"); all.ok() && parseInt(trim(all.out), total)) {
            state.ahead = total;
        }
        return state;
    }

    state.hasUpstream = true;
    state.originSha = trim(origin.out);
    // 왼쪽(origin)에만 있는 커밋 = behind, 오른쪽(HEAD)에만 있는 커밋 = ahead.
    // 두 번의 rev-list 대신 --left-right --count 한 번으로 계산한다.
    auto counts = GitRunner::run(workDir, {"rev-list", "--left-right", "--count", remoteRef + "...HEAD"});
    if (counts.ok()) {
        int behind = 0;
        int ahead = 0;
        std::istringstream stream(counts.out);
        if (stream >> behind >> ahead) {
            state.behind = behind;
            state.ahead = ahead;
        }
    }
    return state;
}

Json::Value syncToJson(const SyncState &state) {
    Json::Value out;
    out["has_upstream"] = state.hasUpstream;
    out["head_sha"] = state.headSha;
    if (state.hasUpstream) {
        out["origin_sha"] = state.originSha;
    }
    out["ahead"] = state.ahead;
    out["behind"] = state.behind;
    return out;
}

// 되돌리기: 열려 있는 doc 을 되돌린 내용으로 맞춘다.
bool resetCollabDocs(int repoId, const std::string &branch, const Json::Value &files) {
    if (files.empty()) {
        return true; // 되돌릴 doc 이 없다 — 맞출 것도 없다.
    }

    Json::Value body;
    body["repo_id"] = repoId;
    body["branch"] = branch;
    body["files"] = files;
    return callCollabInternal("/internal/collab/files/reset", body);
}

// 커밋 전 강제 flush: 아직 파일로 내려가지 않은 편집을 먼저 내려쓴다.
// 이걸 빼면 편집 후 디바운스(2초) 안에 커밋했을 때 그 편집이 커밋에서 빠진다.
bool flushCollabDocs(int repoId, const std::string &branch) {
    Json::Value body;
    body["repo_id"] = repoId;
    body["branch"] = branch;
    return callCollabInternal("/internal/collab/flush", body);
}

// 커밋 전용 flush: 200 응답이면서 내려쓰기 실패가 하나도 없어야 성공이다.
//   - "열린 문서가 없다"(200, failed=0)는 성공으로 본다 — 그때는 파일이 이미 최신이다.
//   - collab 이 죽었거나 제때 응답하지 않으면(타임아웃·5xx) 실패다.
//   - 파일 일부가 못 내려갔으면(failed>0) 실패다.
// 커밋은 이게 성공일 때만 진행한다 — 아니면 디바운스(기본 2초) 안의 마지막 편집이 조용히 빠진
// 커밋이 만들어진다. 그래서 스테이징·되돌리기와 달리 커밋만 결과를 따진다.
bool flushCollabDocsStrict(int repoId, const std::string &branch) {
    Json::Value body;
    body["repo_id"] = repoId;
    body["branch"] = branch;

    Json::Value data;
    if (!callCollabInternal("/internal/collab/flush", body, &data)) {
        return false;
    }
    // 응답 data 는 [{ flushed, failed }] 한 건이다(grad_collab server.ts). failed 가 0 보다 크면 실패.
    if (data.isArray() && !data.empty() && data[0].isObject()) {
        const Json::Value &failed = data[0]["failed"];
        if (failed.isIntegral() && failed.asInt64() > 0) {
            return false;
        }
    }
    return true;
}

// 커밋 잠금 해제 가드. commit_started 를 보낸 뒤로는 어떤 이유로 끝나든
// commit_finished 가 나가야 한다 — 확장은 이 이벤트로만 커밋 입력 잠금을 푼다.
// 그래서 실패로 일찍 return 하거나 예외가 나도 잠금이 남지 않도록 소멸자에서 보낸다.
// 성공 경로는 커밋 결과(sha·ahead…)를 담아 직접 보내고 disarm() 으로 이 가드를 끈다.
class CommitLockGuard {
public:
    CommitLockGuard(int repoId, const std::string &branch, const std::string &email)
        : repoId_(repoId), branch_(branch), email_(email) {
    }

    ~CommitLockGuard() {
        if (!armed_) {
            return;
        }

        // 커밋이 실제로 남았는지와 상관없이 목적은 '잠금 해제' 다 — 확장은 이 필드들을 보지 않는다.
        Json::Value finished;
        finished["type"] = "commit_finished";
        finished["repo_id"] = repoId_;
        finished["branch"] = branch_;
        finished["email"] = email_;
        finished["pushed"] = false;
        GithubWebSocketController::broadcastToBranch(repoId_, branch_, finished);
    }

    void disarm() {
        armed_ = false;
    }

private:
    int repoId_;
    std::string branch_;
    std::string email_;
    bool armed_ = true;
};

// 작업 트리·인덱스 상태가 바뀐 것을 같은 브랜치 접속자에게 알린다.
// 커밋·push 는 전용 이벤트(commit_finished / push_finished)가 있으므로 여기서 다루지 않는다 —
// 스테이징·해제·되돌리기·fetch 처럼 "파일 상태만" 바뀌는 경우에 쓴다. 다른 사용자의 Changes 뷰가
// 곧바로 따라오고, 요청자 자신도 받지만 디바운스된 재조회라 무해하다.
void broadcastStatusChanged(int repoId, const std::string &branch) {
    if (branch.empty()) {
        return; // 방이 브랜치 단위라 어느 방으로 보낼지 정할 수 없다.
    }

    Json::Value event;
    event["type"] = "status_changed";
    event["repo_id"] = repoId;
    event["branch"] = branch;
    GithubWebSocketController::broadcastToBranch(repoId, branch, event);
}

// worktree 내용이 바뀐 경로를 같은 브랜치의 AI 작업공간에도 알린다.
// collab 이 보내는 worktree_changed 와 같은 모양(paths 배열)을 쓴다.
void broadcastWorktreeChanged(int repoId, const std::string &branch,
                              const std::vector<std::string> &paths) {
    if (branch.empty() || paths.empty()) {
        return;
    }

    Json::Value list(Json::arrayValue);
    for (const auto &path : paths) {
        if (!path.empty()) {
            list.append(path);
        }
    }
    if (list.empty()) {
        return;
    }

    Json::Value event;
    event["type"] = "worktree_changed";
    event["repo_id"] = repoId;
    event["branch"] = branch;
    event["paths"] = list;
    GithubWebSocketController::broadcastToBranch(repoId, branch, event);
}

// push 실패 stderr 를 확장이 배지로 구분할 사유로 나눈다.
std::string classifyPushFailure(const std::string &detail) {
    if (detail.find("Authentication failed") != std::string::npos ||
        detail.find("could not read Username") != std::string::npos ||
        detail.find("Support for password authentication") != std::string::npos ||
        detail.find("terminal prompts disabled") != std::string::npos) {
        return "credential_invalid";
    }
    if (detail.find("403") != std::string::npos ||
        detail.find("denied") != std::string::npos ||
        detail.find("protected branch") != std::string::npos) {
        return "denied";
    }
    if (detail.find("non-fast-forward") != std::string::npos ||
        detail.find("fetch first") != std::string::npos ||
        detail.find("rejected") != std::string::npos) {
        return "non_fast_forward";
    }
    return "other";
}

// 사유를 사용자에게 보여 줄 한 줄로 바꾼다.
std::string pushReasonLabel(const std::string &reason) {
    if (reason == "credential_missing") {
        return "GitHub 자격증명이 연결되어 있지 않음";
    }
    if (reason == "credential_invalid") {
        return "GitHub 자격증명이 무효·만료됨";
    }
    if (reason == "denied") {
        return "이 저장소에 push 권한이 없음";
    }
    if (reason == "non_fast_forward") {
        return "원격이 앞서 있음(non-fast-forward)";
    }
    return "원인을 알 수 없음";
}

// 원격 접근 실패를 두 갈래로 나눈다: 저장소가 없거나 권한이 없는 경우 vs 그 밖(네트워크 등).
// GitHub 은 접근 권한이 없는 비공개 저장소도 "not found" 로 답하므로 둘을 구분하지 않는다.
bool isRemoteAccessDenied(const std::string &detail) {
    return detail.find("could not read Username") != std::string::npos ||
           detail.find("terminal prompts disabled") != std::string::npos ||
           detail.find("Authentication failed") != std::string::npos ||
           detail.find("Repository not found") != std::string::npos ||
           detail.find("does not exist") != std::string::npos ||
           detail.find("403") != std::string::npos ||
           detail.find("401") != std::string::npos;
}

// 트리 변경 헬퍼 (파일·디렉터리 생성 / 이름변경 / 삭제)

// 확장이 보낸 저장소 상대 경로가 worktree 밖을 가리키지 않는지 검사한다.
// 절대 경로·'..'·'.git'·빈 조각·역슬래시·널 문자를 모두 거부한다(collab 의 isSafeRelPath 와 같은 규칙).
bool isSafeRelPath(const std::string &path) {
    if (path.empty() || path.size() > 4096) {
        return false;
    }
    if (path.front() == '/' || path.front() == '~' || path.back() == '/') {
        return false;
    }
    if (path.find('\\') != std::string::npos || path.find('\0') != std::string::npos) {
        return false;
    }

    std::size_t start = 0;
    while (true) {
        const std::size_t end = path.find('/', start);
        const std::string segment =
            path.substr(start, (end == std::string::npos) ? std::string::npos : end - start);
        if (segment.empty() || segment == "." || segment == ".." || segment == ".git") {
            return false;
        }
        if (end == std::string::npos) {
            break;
        }
        start = end + 1;
    }
    return true;
}

// AI 작업공간에 복사하지 않을 파일. 비밀값이 들어가기 쉬운 이름만 보수적으로 막는다.
bool isSensitiveAiWorkspacePath(const std::string &path) {
    const std::string lower = lowerCopy(path);
    const std::size_t slash = lower.find_last_of('/');
    const std::string name = (slash == std::string::npos) ? lower : lower.substr(slash + 1);

    if (name == ".env" || (name.rfind(".env.", 0) == 0 && name != ".env.example")) {
        return true;
    }
    if (name == ".npmrc" || name == ".pypirc" || name == ".netrc" || name == ".git-credentials" ||
        name == "credentials.json" || name == "id_rsa" || name == "id_ed25519") {
        return true;
    }
    if (lower == ".ssh" || lower.rfind(".ssh/", 0) == 0 || lower.find("/.ssh/") != std::string::npos) {
        return true;
    }
    return false;
}

// 심볼릭 링크를 따라가지 않고 상한 안의 파일 바이트를 읽는다. 삭제 CAS 처럼 바이너리도 허용해야 할 때 쓴다.
bool readFileBytesLimited(const std::string &absPath, long long maxBytes, std::string &out,
                          std::string &reason) {
    std::error_code ec;
    const auto status = std::filesystem::symlink_status(absPath, ec);
    if (ec || !std::filesystem::is_regular_file(status)) {
        reason = "not_file";
        return false;
    }

    const auto size = std::filesystem::file_size(absPath, ec);
    if (ec) {
        reason = "unreadable";
        return false;
    }
    if (static_cast<long long>(size) > maxBytes) {
        reason = "too_large";
        return false;
    }

    std::ifstream input(absPath, std::ios::binary);
    if (!input) {
        reason = "unreadable";
        return false;
    }
    out.assign(std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>());
    if (!input.good() && !input.eof()) {
        reason = "unreadable";
        return false;
    }
    return true;
}

// UTF-8 로 해석할 수 있는 텍스트인가. JSON 문자열로 옮길 수 없는 파일은 스냅샷에서 제외한다.
bool isValidUtf8(const std::string &text) {
    std::size_t index = 0;
    while (index < text.size()) {
        const unsigned char lead = static_cast<unsigned char>(text[index]);
        if (lead < 0x80) {
            ++index;
            continue;
        }

        std::size_t extra = 0;
        unsigned int codePoint = 0;
        if ((lead & 0xE0) == 0xC0) {
            extra = 1;
            codePoint = lead & 0x1F;
        } else if ((lead & 0xF0) == 0xE0) {
            extra = 2;
            codePoint = lead & 0x0F;
        } else if ((lead & 0xF8) == 0xF0) {
            extra = 3;
            codePoint = lead & 0x07;
        } else {
            return false;
        }

        if (index + extra >= text.size()) {
            return false;
        }
        for (std::size_t offset = 1; offset <= extra; ++offset) {
            const unsigned char next = static_cast<unsigned char>(text[index + offset]);
            if ((next & 0xC0) != 0x80) {
                return false;
            }
            codePoint = (codePoint << 6) | (next & 0x3F);
        }

        static constexpr unsigned int kMinForExtra[] = {0, 0x80, 0x800, 0x10000};
        if (codePoint < kMinForExtra[extra] || codePoint > 0x10FFFF ||
            (codePoint >= 0xD800 && codePoint <= 0xDFFF)) {
            return false;
        }
        index += extra + 1;
    }
    return true;
}

// 일반 텍스트 파일만 읽는다. 심볼릭 링크·디렉터리·바이너리·상한 초과는 사유와 함께 거부한다.
bool readTextFileLimited(const std::string &absPath, long long maxBytes, std::string &out,
                         std::string &reason) {
    if (!readFileBytesLimited(absPath, maxBytes, out, reason)) {
        return false;
    }
    if (out.find('\0') != std::string::npos) {
        reason = "binary";
        return false;
    }
    if (!isValidUtf8(out)) {
        reason = "encoding";
        return false;
    }
    return true;
}

// 중간 경로 조각이 심볼릭 링크면 worktree 밖으로 탈출할 수 있다. 마지막 조각은 호출부가 symlink_status 로 따로 본다.
bool hasSymlinkParent(const std::string &workDir, const std::string &relPath) {
    std::error_code ec;
    const std::filesystem::path root = std::filesystem::weakly_canonical(workDir, ec);
    if (ec) {
        return true;
    }

    std::filesystem::path current = root;
    std::size_t start = 0;
    while (true) {
        const std::size_t slash = relPath.find('/', start);
        if (slash == std::string::npos) {
            break;   // 마지막 조각은 파일 자신이다.
        }

        current /= relPath.substr(start, slash - start);
        const auto status = std::filesystem::symlink_status(current, ec);
        if (ec || std::filesystem::is_symlink(status)) {
            return true;
        }
        if (!std::filesystem::exists(status)) {
            return false;   // 아직 없는 디렉터리 — create_directories 가 새로 만든다.
        }
        start = slash + 1;
    }
    return false;
}

std::string contentHash(const std::string &content) {
    return "sha256:" + sha256Hex(content);
}

// AI 작업공간 manifest 의 변경 토큰. 파일 내용을 읽지 않고 크기와 수정 시각만 사용한다.
// 내용 해시와 달리 서버 디스크를 전부 읽지 않으므로 최초 동기화 판단 비용이 작다.
std::string aiWorkspaceVersion(const std::string &absPath) {
    std::error_code ec;
    const auto size = std::filesystem::file_size(absPath, ec);
    if (ec) {
        return "";
    }
    const auto modified = std::filesystem::last_write_time(absPath, ec);
    if (ec) {
        return "";
    }
    return std::to_string(static_cast<unsigned long long>(size)) + ":" +
           std::to_string(static_cast<long long>(modified.time_since_epoch().count()));
}

// worktree 안의 실제 경로. 상대 경로는 위에서 검증한 것만 넘긴다.
std::string worktreeAbsPath(const std::string &workDir, const std::string &relPath) {
    return workDir + "/" + relPath;
}

// worktree 안에서 그 상대 경로가 파일이든 디렉터리든 존재하는가.
bool worktreePathExists(const std::string &workDir, const std::string &relPath) {
    std::error_code ec;
    return std::filesystem::exists(worktreeAbsPath(workDir, relPath), ec);
}

// workDir/path 디렉터리의 한 단계 항목 이름을 한 번에 모은다.
// tree 조회에서 커밋 항목마다 exists() 를 호출하던 N+1 을 readdir 한 번으로 바꾼다.
std::map<std::string, bool> worktreeChildNames(const std::string &workDir, const std::string &path) {
    std::map<std::string, bool> names;
    const std::string dir = path.empty() ? workDir : worktreeAbsPath(workDir, path);

    std::error_code ec;
    std::filesystem::directory_iterator it(dir, ec);
    const std::filesystem::directory_iterator end;
    while (!ec && it != end) {
        names.emplace(it->path().filename().string(), false);
        it.increment(ec);
    }
    return names;
}

// git 이 그 경로를 추적하는가(인덱스 기준). untracked 는 git mv / git rm 으로 다룰 수 없다.
bool isTrackedPath(const std::string &workDir, const std::string &relPath) {
    return GitRunner::run(workDir, {"ls-files", "--error-unmatch", "--", relPath}).ok();
}

// 경로의 상위 디렉터리('' 이면 루트).
std::string parentOfPath(const std::string &path) {
    const std::size_t slash = path.find_last_of('/');
    return (slash == std::string::npos) ? std::string() : path.substr(0, slash);
}

// 경로의 첫 조각(최상위 이름).
std::string firstComponentOf(const std::string &path) {
    const std::size_t slash = path.find('/');
    return (slash == std::string::npos) ? path : path.substr(0, slash);
}

// path 가 candidate 자신이거나 그 하위 경로인가(디렉터리를 통째로 다룰 때 쓴다).
bool pathCovers(const std::string &path, const std::string &candidate) {
    if (path == candidate) {
        return true;
    }
    return candidate.size() > path.size() && candidate.compare(0, path.size(), path) == 0 &&
           candidate[path.size()] == '/';
}

// 상위 디렉터리를 만든다. 성공하면 빈 문자열, 실패하면 사유.
std::string ensureParentDir(const std::string &absPath) {
    const std::filesystem::path parent = std::filesystem::path(absPath).parent_path();
    if (parent.empty()) {
        return "";   // 저장소 루트 바로 아래 — 만들 것이 없다.
    }
    std::error_code ec;
    std::filesystem::create_directories(parent, ec);
    return ec ? ec.message() : std::string();
}

// 이 작업 디렉터리 안쪽에 있는 다른 worktree 의 상대 경로를 모은다.
// git 은 worktree 를 형제 디렉터리로 만든다. 안쪽에 있다면 과거 상대 경로 버그의 흔적이고,
// 그 트리 전체가 clone 의 untracked 로 보인다 — 저장소 내용이 아니므로 조회에서 걸러낸다.
std::vector<std::string> nestedWorktreePaths(const std::string &workDir) {
    std::vector<std::string> result;

    auto listed = GitRunner::worktreeList(workDir);
    if (!listed.ok()) {
        return result;
    }

    std::error_code ec;
    const std::string root = std::filesystem::absolute(workDir, ec).lexically_normal().string();
    if (ec || root.empty()) {
        return result;
    }

    std::istringstream stream(listed.out);
    std::string line;
    while (std::getline(stream, line)) {
        line = trim(line);
        if (line.rfind("worktree ", 0) != 0) {
            continue;
        }

        const std::string other =
            std::filesystem::absolute(trim(line.substr(std::string("worktree ").size())), ec)
                .lexically_normal()
                .string();
        if (ec || other.empty() || other == root) {
            continue;
        }
        if (other.size() > root.size() + 1 && other.compare(0, root.size(), root) == 0 &&
            other[root.size()] == '/') {
            result.push_back(other.substr(root.size() + 1));
        }
    }
    return result;
}

// AI 작업공간(manifest/archive)이 공유하는 파일 수집 규칙과 결과.
struct AiWorkspaceEntry {
    std::string path;
    std::string absPath;
    long long size = 0;
    std::string version;
};

struct AiWorkspaceCollection {
    std::vector<AiWorkspaceEntry> files;
    Json::Value skipped = Json::Value(Json::arrayValue);
    long long totalBytes = 0;
    int skippedCount = 0;
    bool complete = true;
};

// worktree 에서 AI 가 읽을 수 있는 파일 목록을 모은다. manifest 와 archive 가 같은 제한을 쓰도록 한 곳에 둔다.
bool collectAiWorkspaceFiles(const std::string &workDir, AiWorkspaceCollection &out, std::string &error) {
    auto listed = GitRunner::lsFiles(workDir, {"--cached", "--others", "--exclude-standard"});
    if (!listed.ok()) {
        error = trim(listed.err);
        return false;
    }

    const std::vector<std::string> nested = nestedWorktreePaths(workDir);
    auto skip = [&out](const std::string &path, const std::string &reason) {
        if (out.skippedCount >= 200) {
            out.complete = false;
            return;
        }
        Json::Value item;
        item["path"] = path;
        item["reason"] = reason;
        out.skipped.append(item);
        ++out.skippedCount;
    };

    for (const std::string &rawPath : splitNul(listed.out)) {
        const std::string path = normalizePath(rawPath);
        if (path.empty() || !isSafeRelPath(path)) {
            continue;
        }
        if (path == ".axis" || path.rfind(".axis/", 0) == 0 || path.rfind(".worktrees/", 0) == 0) {
            continue;
        }

        bool nestedPath = false;
        for (const std::string &root : nested) {
            if (pathCovers(root, path)) {
                nestedPath = true;
                break;
            }
        }
        if (nestedPath) {
            continue;
        }

        if (isSensitiveAiWorkspacePath(path)) {
            skip(path, "sensitive");
            continue;
        }
        if (hasSymlinkParent(workDir, path)) {
            skip(path, "symlink");
            continue;
        }
        if (static_cast<int>(out.files.size()) >= kMaxAiWorkspaceFiles) {
            skip(path, "file_limit");
            out.complete = false;
            continue;
        }

        const std::string target = worktreeAbsPath(workDir, path);
        std::error_code ec;
        const auto linkStatus = std::filesystem::symlink_status(target, ec);
        if (ec || !std::filesystem::is_regular_file(linkStatus)) {
            skip(path, "not_file");
            continue;
        }
        const auto size = std::filesystem::file_size(target, ec);
        if (ec) {
            skip(path, "unreadable");
            continue;
        }
        const long long fileBytes = static_cast<long long>(size);
        if (fileBytes > kMaxAiWorkspaceFileBytes) {
            skip(path, "too_large");
            continue;
        }
        if (out.totalBytes + fileBytes > kMaxAiWorkspaceTotalBytes) {
            skip(path, "size_limit");
            out.complete = false;
            continue;
        }

        const std::string version = aiWorkspaceVersion(target);
        if (version.empty()) {
            skip(path, "unreadable");
            continue;
        }

        out.files.push_back(AiWorkspaceEntry{path, target, fileBytes, version});
        out.totalBytes += fileBytes;
    }
    return true;
}

// USTAR 헤더의 8진수 필드. width 안에 (width-1) 자리 숫자와 NUL 을 채운다.
void writeTarOctal(char *field, std::size_t width, unsigned long long value) {
    std::snprintf(field, width, "%0*llo", static_cast<int>(width - 1), value);
}

// USTAR name(100) + prefix(155) 로 경로를 나눈다. 둘 다 넘으면 아카이브에서 제외한다.
bool splitUstarPath(const std::string &path, std::string &name, std::string &prefix) {
    if (path.size() <= 100) {
        name = path;
        prefix.clear();
        return true;
    }
    if (path.size() > 255) {
        return false;
    }

    const std::size_t start = path.size() - 100;
    for (std::size_t pos = start; pos < path.size() && pos <= 155; ++pos) {
        if (pos == 0 || path[pos] != '/') {
            continue;
        }
        const std::size_t nameLength = path.size() - pos - 1;
        if (nameLength == 0 || nameLength > 100) {
            continue;
        }
        prefix = path.substr(0, pos);
        name = path.substr(pos + 1);
        return true;
    }
    return false;
}

void appendTarHeader(std::string &tar, const std::string &name, const std::string &prefix,
                     long long size, std::time_t mtime) {
    char header[512] = {0};
    std::memcpy(header, name.data(), name.size());
    std::memcpy(header + 100, "0000644", 7);
    std::memcpy(header + 108, "0000000", 7);
    std::memcpy(header + 116, "0000000", 7);
    writeTarOctal(header + 124, 12, static_cast<unsigned long long>(size));
    writeTarOctal(header + 136, 12, static_cast<unsigned long long>(mtime));
    std::memset(header + 148, ' ', 8);
    header[156] = '0';
    std::memcpy(header + 257, "ustar", 5);
    header[262] = '\0';
    std::memcpy(header + 263, "00", 2);
    std::memcpy(header + 265, "root", 4);
    std::memcpy(header + 297, "root", 4);
    if (!prefix.empty()) {
        std::memcpy(header + 345, prefix.data(), prefix.size());
    }

    unsigned long long checksum = 0;
    for (std::size_t i = 0; i < sizeof(header); ++i) {
        checksum += static_cast<unsigned char>(header[i]);
    }
    std::snprintf(header + 148, 8, "%06llo", checksum);
    tar.append(header, sizeof(header));
}

bool gzipCompress(const std::string &input, std::string &out, std::string &error) {
    z_stream stream{};
    if (deflateInit2(&stream, Z_DEFAULT_COMPRESSION, Z_DEFLATED, 15 + 16, 8, Z_DEFAULT_STRATEGY) != Z_OK) {
        error = "zlib deflateInit2 failed";
        return false;
    }

    stream.next_in = reinterpret_cast<Bytef *>(const_cast<char *>(input.data()));
    stream.avail_in = static_cast<uInt>(input.size());
    std::vector<char> buffer(64 * 1024);
    int result = Z_OK;
    while (result != Z_STREAM_END) {
        stream.next_out = reinterpret_cast<Bytef *>(buffer.data());
        stream.avail_out = static_cast<uInt>(buffer.size());
        result = deflate(&stream, Z_FINISH);
        if (result != Z_OK && result != Z_STREAM_END) {
            deflateEnd(&stream);
            error = "zlib deflate failed";
            return false;
        }
        out.append(buffer.data(), buffer.size() - stream.avail_out);
    }

    deflateEnd(&stream);
    return true;
}

// 현재 worktree 의 AI 작업공간 대상 텍스트 파일을 USTAR tar.gz 하나로 묶는다.
// git archive 는 HEAD 기준이라 작업 중인 수정·untracked 파일이 빠지므로 쓰지 않는다.
bool buildAiWorkspaceArchive(const std::string &workDir, std::string &out, std::string &error) {
    AiWorkspaceCollection collection;
    if (!collectAiWorkspaceFiles(workDir, collection, error)) {
        return false;
    }

    std::string tar;
    tar.reserve(static_cast<std::size_t>(collection.totalBytes) + collection.files.size() * 1024 + 1024);
    const std::time_t now = std::time(nullptr);
    for (const AiWorkspaceEntry &entry : collection.files) {
        std::string name;
        std::string prefix;
        if (!splitUstarPath(entry.path, name, prefix)) {
            continue;
        }

        std::string content;
        std::string reason;
        if (!readTextFileLimited(entry.absPath, kMaxAiWorkspaceFileBytes, content, reason)) {
            continue;   // 바이너리·인코딩·크기 초과 파일은 개별 조회와 같은 규칙으로 제외한다.
        }

        appendTarHeader(tar, name, prefix, static_cast<long long>(content.size()), now);
        tar.append(content);
        const std::size_t remainder = content.size() % 512;
        if (remainder != 0) {
            tar.append(512 - remainder, '\0');
        }
    }

    tar.append(1024, '\0');
    return gzipCompress(tar, out, error);
}

// ls-tree(커밋된 트리)에는 없고 이 브랜치의 작업 디렉터리에만 있는 항목 이름을 한 단계 분량으로 모은다.
//
// 브랜치마다 작업 디렉터리가 따로 있으므로, 새로 만든 파일은 그것을 만든 브랜치에만 보인다.
// 인덱스에 올라간 파일(intent-to-add 포함)과 무시되지 않은 untracked 파일을 함께 보고,
// 요청한 디렉터리보다 깊은 경로는 디렉터리 하나로 접는다 — 트리는 한 단계씩 펼치는 구조다.
std::map<std::string, bool> worktreeOnlyNames(const std::string &workDir, const std::string &path) {
    std::map<std::string, bool> names;   // 이름 → 디렉터리인가

    // 저장소 안쪽에 남은 worktree(과거 버그 흔적)는 저장소 내용이 아니다 — 최상위 이름째로 무시한다.
    std::map<std::string, bool> noiseRoots;
    for (const auto &nested : nestedWorktreePaths(workDir)) {
        noiseRoots[firstComponentOf(nested)] = true;
    }
    noiseRoots[".worktrees"] = true;

    const std::string prefix = path.empty() ? std::string() : (path + "/");
    const std::string pathspec = path.empty() ? "." : path;

    auto collect = [&](const GitResult &result) {
        for (const auto &full : splitNul(result.out)) {
            if (full.empty() || noiseRoots.find(firstComponentOf(full)) != noiseRoots.end()) {
                continue;
            }
            if (!prefix.empty() &&
                (full.size() <= prefix.size() || full.compare(0, prefix.size(), prefix) != 0)) {
                continue;   // 요청한 디렉터리 밖
            }

            const std::string rest = full.substr(prefix.size());
            const std::size_t slash = rest.find('/');
            names.emplace((slash == std::string::npos) ? rest : rest.substr(0, slash),
                          slash != std::string::npos);
        }
    };
    // tracked(index) 와 untracked 를 한 번의 git 호출로 모은다.
    collect(GitRunner::lsFiles(workDir, {"--cached", "--others", "--exclude-standard", "--", pathspec}));

    return names;
}

// 작업 트리 상태에서 "저장소 내용이 아닌" 항목(안쪽 worktree 등)을 걸러낸다.
Json::Value filterNoiseEntries(const Json::Value &entries, const std::vector<std::string> &noise) {
    if (noise.empty() || !entries.isArray()) {
        return entries;
    }

    Json::Value filtered(Json::arrayValue);
    for (const auto &entry : entries) {
        const std::string path = entry["path"].asString();
        bool noisy = false;
        for (const auto &prefix : noise) {
            if (pathCovers(prefix, path)) {
                noisy = true;
                break;
            }
        }
        if (!noisy) {
            filtered.append(entry);
        }
    }
    return filtered;
}

// 요청 처리 뒤 최신 작업 트리 상태를 응답으로 돌려준다(스테이징·되돌리기와 같은 규격).
HttpResponsePtr respondWithStatus(const std::string &workDir, const std::string &message,
                                  HttpStatusCode code = k200OK) {
    GitResult statusResult;
    const Json::Value entries = readWorktreeStatus(workDir, statusResult);
    if (!statusResult.ok()) {
        return errorResponse("P0807", "작업 트리 상태를 읽지 못했습니다: " + trim(statusResult.err),
                             k500InternalServerError);
    }
    return successResponse(entries, message, code);
}

// collab 에게 "이 경로들의 doc 을 버려라" 라고 알린다(파일 삭제·이름변경).
// collab 은 메모리의 doc 과 영속화된 .ydoc 를 함께 지운다 — 남겨 두면 다음 flush 가 지운 파일을 되살린다.
bool dropCollabDocs(int repoId, const std::string &branch, const std::vector<std::string> &paths) {
    if (paths.empty()) {
        return true;
    }

    Json::Value body;
    body["repo_id"] = repoId;
    body["branch"] = branch;
    Json::Value list(Json::arrayValue);
    for (const auto &path : paths) {
        list.append(path);
    }
    body["paths"] = list;
    return callCollabInternal("/internal/collab/files/drop", body);
}

// collab 에게 "이 브랜치의 방과 영속화 상태를 버려라" 라고 알린다(브랜치 삭제).
// worktree 를 지운 뒤에 부르면 남은 doc 의 flush 가 그 디렉터리를 되살리므로 반드시 먼저 부른다.
bool dropCollabBranch(int repoId, const std::string &branch) {
    if (branch.empty()) {
        return true;
    }

    Json::Value body;
    body["repo_id"] = repoId;
    body["branch"] = branch;
    return callCollabInternal("/internal/collab/branch/drop", body);
}

// 트리 변경을 같은 브랜치 접속자에게 알린다. 확장은 이 이벤트로 Repository 트리를 다시 그린다.
void broadcastTreeChanged(int repoId, const std::string &branch, const std::string &type,
                          const std::string &path, const std::string &from = "") {
    if (branch.empty()) {
        return;
    }

    Json::Value event;
    event["type"] = type;
    event["repo_id"] = repoId;
    event["branch"] = branch;
    event["path"] = path;
    if (!from.empty()) {
        event["from"] = from;
    }
    GithubWebSocketController::broadcastToBranch(repoId, branch, event);
}

// pull/reset 으로 브랜치 이력이 바뀌었음을 알린다. status_changed 와 달리 Graph 뷰의 커밋 목록도
// 다시 받아야 한다 — 확장은 이 이벤트 하나로 Changes 와 Graph 를 함께 갱신한다.
void broadcastBranchSynced(int repoId, const std::string &branch, const std::string &email,
                           const std::string &action) {
    if (branch.empty()) {
        return;
    }

    Json::Value event;
    event["type"] = "branch_synced";
    event["repo_id"] = repoId;
    event["branch"] = branch;
    event["email"] = email;
    event["action"] = action;
    GithubWebSocketController::broadcastToBranch(repoId, branch, event);
}

// 병합 충돌 경로. 충돌이 없으면 빈 배열이다.
Json::Value unmergedPaths(const std::string &workDir) {
    Json::Value paths(Json::arrayValue);
    auto diff = GitRunner::run(workDir, {"diff", "--name-only", "--diff-filter=U", "-z"});
    if (!diff.ok()) {
        return paths;
    }
    for (const std::string &path : splitNul(diff.out)) {
        if (!path.empty()) {
            paths.append(path);
        }
    }
    return paths;
}

// `git diff --name-status -z` 를 파싱한 변경 한 건. kind 는 git 의 상태 문자(A/M/D/R/C/T)다.
struct TreeChange {
    char kind = 'M';
    std::string from;
    std::string path;
    // reset 전 작업 트리에만 있던 변경을 되살리기 위해 넣은 항목이면 true.
    // 커밋 사이 diff 에는 없지만 worktree/tree 뷰와 Y.Doc 은 갱신해야 한다.
    bool restored = false;
};

std::vector<TreeChange> changedPathsBetween(const std::string &workDir, const std::string &fromSha,
                                            const std::string &toSha) {
    std::vector<TreeChange> changes;
    if (fromSha.empty() || toSha.empty() || fromSha == toSha) {
        return changes;
    }

    auto diff = GitRunner::run(workDir, {"diff", "--name-status", "-z", "--find-renames", "--no-ext-diff",
                                         fromSha, toSha});
    if (!diff.ok()) {
        LOG_WARN << "브랜치 변경 경로 조회 실패 (" << fromSha << ".." << toSha << "): " << trim(diff.err);
        return changes;
    }

    const std::vector<std::string> tokens = splitNul(diff.out);
    std::size_t index = 0;
    while (index < tokens.size()) {
        const std::string status = tokens[index++];
        if (status.empty()) {
            continue;
        }

        const char kind = status.front();
        if (kind == 'R' || kind == 'C') {
            if (index + 1 >= tokens.size()) {
                break;
            }
            TreeChange change;
            change.kind = kind;
            change.from = tokens[index++];
            change.path = tokens[index++];
            changes.push_back(std::move(change));
            continue;
        }

        if (index >= tokens.size()) {
            break;
        }
        TreeChange change;
        change.kind = kind;
        change.path = tokens[index++];
        changes.push_back(std::move(change));
    }
    return changes;
}

// pull/reset 으로 바뀐 worktree 내용을 열려 있는 Y.Doc 에 반영하고, 같은 브랜치의 확장들에게
// 트리·상태 변경을 알린다. 큰 파일·바이너리는 collab 이 doc 으로 열지 않으므로 통보에서 뺀다.
// extraPaths 는 hard reset 이 버린 미커밋 경로다. 커밋 diff 에 없어도 Y.Doc 을 현재 파일로 맞춰야
// 다음 flush 가 버린 내용을 되살리지 않는다.
int syncCollabAndBroadcastChanges(int repoId, const std::string &branch, const std::string &workDir,
                                  const std::string &fromSha, const std::string &toSha,
                                  const std::vector<std::string> &extraPaths = {}) {
    std::vector<TreeChange> changes = changedPathsBetween(workDir, fromSha, toSha);
    for (const std::string &path : extraPaths) {
        if (!isSafeRelPath(path)) {
            continue;
        }
        const bool known = std::any_of(changes.begin(), changes.end(), [&path](const TreeChange &change) {
            return change.path == path || change.from == path;
        });
        if (known) {
            continue;
        }

        TreeChange extra;
        extra.path = path;
        extra.restored = true;
        extra.kind = worktreePathExists(workDir, path) ? 'M' : 'D';
        changes.push_back(std::move(extra));
    }
    if (changes.empty()) {
        broadcastStatusChanged(repoId, branch);
        return 0;
    }

    constexpr std::size_t kCollabDocLimit = 512 * 1024;
    constexpr std::size_t kResetPayloadLimit = 8 * 1024 * 1024;
    Json::Value files(Json::arrayValue);
    std::size_t payloadBytes = 0;
    std::vector<std::string> changedPaths;

    const auto addDeletedDoc = [&files](const std::string &path) {
        if (!isSafeRelPath(path)) {
            return;
        }
        Json::Value file;
        file["path"] = path;
        file["deleted"] = true;
        files.append(file);
    };

    for (const TreeChange &change : changes) {
        if (!change.path.empty()) {
            changedPaths.push_back(change.path);
        }
        if (!change.from.empty()) {
            changedPaths.push_back(change.from);
        }

        if (change.kind == 'D') {
            addDeletedDoc(change.path);
            continue;
        }
        if (change.kind == 'R' && !change.from.empty()) {
            addDeletedDoc(change.from);
        }

        if (!isSafeRelPath(change.path)) {
            continue;
        }
        std::string text;
        std::string reason;
        if (!readTextFileLimited(worktreeAbsPath(workDir, change.path), kCollabDocLimit, text, reason)) {
            continue;
        }
        if (!isValidUtf8(text) || payloadBytes + text.size() > kResetPayloadLimit) {
            continue;
        }
        payloadBytes += text.size();
        Json::Value file;
        file["path"] = change.path;
        file["text"] = toLf(text);
        files.append(file);
    }

    if (!resetCollabDocs(repoId, branch, files)) {
        LOG_WARN << "pull/reset 뒤 collab doc 동기화 실패 (repo=" << repoId << ", branch=" << branch << ")";
    }

    for (const TreeChange &change : changes) {
        if (change.kind == 'A' || change.kind == 'C') {
            broadcastTreeChanged(repoId, branch, "file_created", change.path);
        } else if (change.kind == 'D') {
            broadcastTreeChanged(repoId, branch, "file_deleted", change.path);
        } else if (change.kind == 'R') {
            broadcastTreeChanged(repoId, branch, "file_moved", change.path, change.from);
        } else if (change.restored) {
            // modified 파일은 hard reset 뒤에도 트리에 남아 있다. 그래도 경로 캐시를 비워야
            // 되돌리기 전 상태가 남지 않는다(Pull/Reset 뒤 다른 확장도 즉시 따라오게).
            broadcastTreeChanged(repoId, branch, "file_restored", change.path);
        }
    }
    broadcastWorktreeChanged(repoId, branch, changedPaths);
    broadcastStatusChanged(repoId, branch);
    return static_cast<int>(changes.size());
}
}  // namespace

// 저장소 연결 / 목록 / 해제

// POST /api/github/repos — 저장소 연결 + 서버 로컬 clone
void GithubController::connectRepository(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    auto jsonPtr = req->getJsonObject();
    if (!jsonPtr || !validateStrings(jsonPtr, "owner_login", "repo_name") || !validateInts(jsonPtr, "node_id")) {
        callback(errorResponse("400", "필수 파라미터(node_id, owner_login, repo_name)가 누락되었습니다.", k400BadRequest));
        return;
    }

    const std::string requester = requesterEmail(req);
    const int nodeId = (*jsonPtr)["node_id"].asInt();
    const std::string owner = (*jsonPtr)["owner_login"].asString();
    const std::string repo = (*jsonPtr)["repo_name"].asString();
    const std::string requestedBranch = (*jsonPtr)["default_branch"].isNull() ? "" : (*jsonPtr)["default_branch"].asString();
    const std::string givenUrl = (*jsonPtr)["clone_url"].isNull() ? "" : (*jsonPtr)["clone_url"].asString();

    runNetworkOffLoop(req, std::move(callback), [requester, nodeId, owner, repo, requestedBranch, givenUrl]() -> HttpResponsePtr {
        auto db = app().getDbClient();
        const std::string url = givenUrl.empty()
                                    ? ("https://github.com/" + owner + "/" + repo + ".git")
                                    : givenUrl;
        const std::string localPath = localPathFor(nodeId, repo);

        // clone 이 체크아웃한 브랜치를 기본 브랜치로 채택할 수 있으므로 로컬 사본을 쓴다.
        // (값으로 캡처한 requestedBranch 는 람다 안에서 const 라 그대로 대입할 수 없다)
        std::string defaultBranch = requestedBranch;

        // 1) 토큰이 있으면 clone/fetch 에 쓴다(비공개 저장소). 없으면 익명으로 시도한다.
        GitRunner::Auth auth;
        bool authenticated = false;
        const std::string token = userToken(db, requester);
        if (!token.empty()) {
            auth.login = "x-access-token";
            auth.token = token;
            authenticated = true;
        }

        // 2) 이미 clone 되어 있으면 fetch 만 한다(멱등). 처음이면 clone.
        std::error_code ec;
        if (std::filesystem::exists(localPath + "/.git", ec)) {
            auto fetched = GitRunner::fetchAll(localPath, authenticated ? &auth : nullptr);
            if (!fetched.ok()) {
                LOG_WARN << "git fetch 실패 (" << localPath << "): " << trim(fetched.err);
            }
        } else {
            // clone 은 저장소 크기만큼 오래 걸린다. 없는 저장소·권한 없는 저장소에 대고 clone 을
            // 시도하지 않도록 원격 접근만 먼저 확인한다 (ref 광고만 받는 싼 점검).
            auto probe = GitRunner::lsRemote(url, authenticated ? &auth : nullptr);
            if (!probe.ok()) {
                LOG_WARN << "git ls-remote 실패 (" << url << "): " << trim(probe.err);
                if (isRemoteAccessDenied(probe.err)) {
                    return errorResponse("P0808",
                                         authenticated
                                             ? "저장소를 찾을 수 없거나 접근 권한이 없습니다. 소유자·이름을 확인해 주세요."
                                             : "저장소를 찾을 수 없거나 접근 권한이 없습니다. 비공개 저장소라면 GitHub 자격증명(PAT)을 먼저 등록해 주세요.",
                                         k404NotFound);
                }
                return errorResponse("P0808", "GitHub 저장소에 연결하지 못했습니다. 네트워크와 주소를 확인해 주세요.",
                                     k502BadGateway);
            }

            std::filesystem::create_directories("repository/" + std::to_string(nodeId), ec);
            auto cloned = GitRunner::clone("repository/" + std::to_string(nodeId), url, repo,
                                           authenticated ? &auth : nullptr);
            if (!cloned.ok()) {
                LOG_WARN << "git clone 실패 (" << url << "): " << trim(cloned.err);
                return errorResponse("P0808", "저장소를 clone 하지 못했습니다. 잠시 후 다시 시도해 주세요.",
                                     k502BadGateway);
            }
            // clone 이 체크아웃한 브랜치가 곧 기본 브랜치다.
            auto branch = GitRunner::currentBranch(localPath);
            if (branch.ok() && !trim(branch.out).empty()) {
                defaultBranch = trim(branch.out);
            }
        }

        if (defaultBranch.empty()) {
            defaultBranch = "main";
        }

        // 3) DB 행 생성/복구. local_path 는 SQL 이 같은 식으로 계산한다.
        auto result = db->execSqlSync(
            "SELECT * FROM create_github_repository($1, $2, $3, $4, $5, $6)",
            requester, nodeId, owner, repo, url, defaultBranch);

        Json::Value repositoryRow;
        if (singleRow(result, repositoryRow) && repositoryRow["is_new_connection"].asBool()) {
            notifyGithubEvent(db, nodeId, repositoryRow["repo_id"].asInt(),
                              owner + "/" + repo, requester,
                              "GITHUB_REPOSITORY", std::to_string(repositoryRow["repo_id"].asInt()),
                              "inserted");
        }

        return successResponse(rowsToArray(result), "저장소를 연결했습니다.", k201Created);
    });
}

// GET /api/github/repos?node_id=12 — 노드에 연결된 저장소 목록
void GithubController::getRepositories(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    int nodeId = 0;
    if (!parseInt(req->getParameter("node_id"), nodeId)) {
        callback(errorResponse("400", "필수 파라미터(node_id)가 누락되었거나 올바르지 않습니다.", k400BadRequest));
        return;
    }

    const std::string requester = requesterEmail(req);
    runOffLoop(req, std::move(callback), [requester, nodeId]() -> HttpResponsePtr {
        auto db = app().getDbClient();
        auto result = db->execSqlSync("SELECT * FROM get_github_repositories_by_node($1, $2)", requester, nodeId);
        return successResponse(rowsToArray(result), "저장소 목록을 조회했습니다.");
    });
}

// DELETE /api/github/repos?repo_id=3 — 연결 해제(소프트 삭제)
void GithubController::disconnectRepository(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    int repoId = 0;
    if (!parseInt(req->getParameter("repo_id"), repoId)) {
        callback(errorResponse("400", "필수 파라미터(repo_id)가 누락되었거나 올바르지 않습니다.", k400BadRequest));
        return;
    }

    const std::string requester = requesterEmail(req);
    runOffLoop(req, std::move(callback), [requester, repoId]() -> HttpResponsePtr {
        auto db = app().getDbClient();
        // clone 디렉터리는 지우지 않는다. 연결만 끊고 다시 연결하면 그대로 재사용한다.
        auto result = db->execSqlSync("SELECT * FROM delete_github_repository($1, $2)", requester, repoId);
        Json::Value repositoryRow;
        if (singleRow(result, repositoryRow)) {
            notifyGithubEvent(db, repositoryRow["node_id"].asInt(), repoId,
                              repositoryRow["owner_login"].asString() + "/" + repositoryRow["repo_name"].asString(),
                              requester, "GITHUB_REPOSITORY", std::to_string(repoId), "deleted");
        }
        return successResponse(rowsToArray(result), "저장소 연결을 해제했습니다.");
    });
}

// 서버 로컬 저장소 조회

// GET /api/github/repos/tree?repo_id=3&branch=main&path=src — 디렉터리 한 단계(파일 내용 제외)
void GithubController::getRepositoryTree(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    int repoId = 0;
    if (!parseInt(req->getParameter("repo_id"), repoId)) {
        callback(errorResponse("400", "필수 파라미터(repo_id)가 누락되었거나 올바르지 않습니다.", k400BadRequest));
        return;
    }

    const std::string branch = req->getParameter("branch");
    const std::string path = normalizePath(req->getParameter("path"));
    const std::string requester = requesterEmail(req);

    runOffLoop(req, std::move(callback), [requester, repoId, branch, path]() -> HttpResponsePtr {
        auto db = app().getDbClient();
        Json::Value repoRow;
        if (!singleRow(db->execSqlSync("SELECT * FROM get_github_repository_by_id($1, $2)", requester, repoId), repoRow)) {
            return errorResponse("P0801", "연결된 저장소를 찾을 수 없습니다.", k404NotFound);
        }

        const std::string localPath = repoRow["local_path"].asString();
        const std::string requested = branch.empty() ? repoRow["default_branch"].asString() : branch;
        const std::string ref = resolveTreeish(localPath, requested);

        if (ref.empty()) {
            return errorResponse("P0801", "브랜치를 찾을 수 없습니다: " + requested, k404NotFound);
        }

        // 작업 트리 기준 경로. ls-tree 는 커밋된 트리만 알므로, 아직 커밋되지 않은 추가·삭제는
        // 이 브랜치의 worktree 에서 판단한다(기본 브랜치는 localPath, 나머지는 브랜치 worktree).
        // worktree 를 준비하지 못하면 커밋된 트리만 보여준다 — 조회 자체를 실패시키지 않는다.
        std::string workDir;
        HttpResponsePtr workDirFailure;
        const bool hasWorkDir = resolveWorkDir(requester, repoRow, requested, workDir, workDirFailure);
        if (!hasWorkDir) {
            LOG_WARN << "worktree 확인 실패 (" << requested << "): 커밋된 트리만 조회합니다";
        }

        // 디렉터리 단위 lazy 조회: 요청한 경로의 한 단계만 받는다.
        // 현재 디렉터리의 실제 항목을 한 번만 읽는다. 커밋 항목별 exists() 호출을 없앤다.
        std::map<std::string, bool> worktreeChildren;
        if (hasWorkDir) {
            worktreeChildren = worktreeChildNames(workDir, path);
        }

        auto tree = GitRunner::lsTree(localPath, ref, path, true);

        // 아직 커밋에 없는 디렉터리(새 폴더 안에 파일만 만든 경우)는 ls-tree 가 실패한다.
        // 작업 트리에 그 디렉터리가 있으면 커밋된 항목이 없는 것으로 보고 worktree 항목만 모은다.
        if (!tree.ok() && (!hasWorkDir || path.empty() || !worktreePathExists(workDir, path))) {
            LOG_WARN << "ls-tree 실패 (" << ref << ":" << path << "): " << trim(tree.err);
            return errorResponse("P0801", "브랜치 또는 경로를 찾을 수 없습니다: " + ref, k404NotFound);
        }

        Json::Value items(Json::arrayValue);
        std::map<std::string, bool> present;   // ls-tree 가 이미 담은 이름(중복 방지)
        for (const auto &entry : splitNul(tree.out)) {
            // "<mode> <type> <object> <size>\t<name>"
            const auto tab = entry.find('\t');
            if (tab == std::string::npos) {
                continue;
            }

            std::istringstream meta(entry.substr(0, tab));
            std::string mode;
            std::string type;
            std::string object;
            std::string size;
            meta >> mode >> type >> object >> size;

            const std::string name = entry.substr(tab + 1);
            const std::string relPath = path.empty() ? name : (path + "/" + name);

            // 작업 트리에서 지운 항목은 아직 커밋에 남아 있어도 트리에서 감춘다.
            if (hasWorkDir && worktreeChildren.find(name) == worktreeChildren.end()) {
                continue;
            }

            Json::Value node;
            node["name"] = name;
            node["path"] = relPath;

            if (type == "tree") {
                node["type"] = "dir";
            } else if (type == "commit") {
                node["type"] = "submodule";
            } else {
                int fileSize = 0;
                node["type"] = "file";
                node["size"] = static_cast<Json::Int64>(parseInt(size, fileSize) ? fileSize : 0);
            }
            items.append(node);
            present[name] = (type == "tree");
        }

        // 커밋된 트리(ls-tree)에는 없고 이 브랜치의 작업 디렉터리에만 있는 항목을 덧붙인다.
        // 새로 만든 파일·디렉터리는 그것을 만든 브랜치의 worktree 에만 있으므로 다른 브랜치에는 나타나지 않는다.
        // (빈 디렉터리는 git 이 추적하지 않아 여기에도 나오지 않는다 — git 사용자에게는 익숙한 동작이다.)
        if (hasWorkDir) {
            for (const auto &item : worktreeOnlyNames(workDir, path)) {
                if (present.find(item.first) != present.end()) {
                    continue;
                }
                // index 에는 남아 있지만 작업 트리에서 지운 파일은 다시 보여주지 않는다.
                if (worktreeChildren.find(item.first) == worktreeChildren.end()) {
                    continue;
                }

                Json::Value node;
                node["name"] = item.first;
                node["path"] = path.empty() ? item.first : (path + "/" + item.first);
                node["type"] = item.second ? "dir" : "file";
                node["worktree_only"] = true;   // 아직 커밋되지 않은 항목
                items.append(node);
            }
        }

        return successResponse(items, "저장소 구조를 조회했습니다.");
    });
}

// GET /api/github/repos/file?repo_id=3&branch=main&path=src/a.ts&ref=index — 파일 내용
// ref 가 비었거나 head 면 브랜치 tip(= HEAD)의 커밋된 내용, index 면 worktree 인덱스(스테이징된 내용),
// 그 밖에는 임의 rev(<sha>, origin/<branch>, <sha>^; diff 4·5번)다.
// '그 버전에 파일이 없음'(HEAD 에 없는 새 파일 / 인덱스에 안 올라간 파일)은 404 이고, 호출자는 빈 문서로 본다.
void GithubController::getRepositoryFile(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    int repoId = 0;
    if (!parseInt(req->getParameter("repo_id"), repoId)) {
        callback(errorResponse("400", "필수 파라미터(repo_id)가 누락되었거나 올바르지 않습니다.", k400BadRequest));
        return;
    }

    const std::string branch = req->getParameter("branch");
    const std::string path = normalizePath(req->getParameter("path"));
    if (path.empty() || !isSafeRelPath(path)) {
        callback(errorResponse("400", "필수 파라미터(path)가 누락되었거나 올바르지 않습니다.", k400BadRequest));
        return;
    }

    // 클라이언트가 캐시한 시각(직전 응답의 modified_at). 같으면 내용을 다시 보내지 않는다.
    const std::string since = req->getParameter("since");

    // 어느 버전을 읽을지. "index" = 그 브랜치 worktree 의 인덱스(스테이징된 내용),
    // 비어 있거나 "head" = 브랜치 tip(= HEAD) 의 커밋된 내용(기존 동작 그대로),
    // 그 밖에는 임의 rev(<sha>, origin/<branch>, <sha>^) — diff 4·5번이 쓴다.
    const std::string refKind = trim(req->getParameter("ref"));
    if (!refKind.empty() && refKind != "head" && refKind != "index" && refKind != "worktree" && !isValidRev(refKind)) {
        callback(errorResponse("400", "알 수 없는 ref 입니다: " + refKind + " (head|index|worktree|<rev>)", k400BadRequest));
        return;
    }

    const std::string requester = requesterEmail(req);
    runOffLoop(req, std::move(callback), [requester, repoId, branch, path, since, refKind]() -> HttpResponsePtr {
        auto db = app().getDbClient();
        Json::Value repoRow;
        if (!singleRow(db->execSqlSync("SELECT * FROM get_github_repository_by_id($1, $2)", requester, repoId), repoRow)) {
            return errorResponse("P0801", "연결된 저장소를 찾을 수 없습니다.", k404NotFound);
        }

        const std::string localPath = repoRow["local_path"].asString();
        const std::string requested = branch.empty() ? repoRow["default_branch"].asString() : branch;

        // worktree: 아직 커밋·스테이징되지 않은 현재 디스크 내용. AI MCP 의 최신 파일 읽기와 CAS 기준이다.
        if (refKind == "worktree") {
            std::string workDir;
            HttpResponsePtr failure;
            if (!resolveWorkDir(requester, repoRow, requested, workDir, failure)) {
                return failure;
            }
            if (hasSymlinkParent(workDir, path)) {
                return errorResponse("P0816", "심볼릭 링크를 거치는 경로는 읽을 수 없습니다: " + path,
                                     k409Conflict);
            }
            flushCollabDocs(repoId, requested);

            const std::string target = worktreeAbsPath(workDir, path);
            std::error_code sizeEc;
            const auto size = std::filesystem::file_size(target, sizeEc);
            Json::Value data;
            data["repo_id"] = repoId;
            data["branch"] = requested;
            data["path"] = path;
            data["size"] = sizeEc ? 0 : static_cast<Json::Int64>(size);
            data["version"] = aiWorkspaceVersion(target);
            data["encoding"] = "utf-8";
            data["read_only"] = false;
            data["content"] = "";
            data["changed"] = true;
            data["modified_at"] = contentHash("");
            data["content_hash"] = "";

            std::string content;
            std::string reason;
            if (!readTextFileLimited(target, kMaxReadOnlyFileBytes, content, reason)) {
                data["read_only"] = true;
                data["reason"] = reason;
                data["content_omitted"] = true;
                if (reason == "binary") {
                    data["encoding"] = "binary";
                }
                return successResponse(singleItemArray(data),
                                       reason == "binary" ? "바이너리 파일이라 내용을 싣지 않았습니다."
                                                          : "파일을 읽을 수 없습니다: " + reason);
            }

            data["content"] = content;
            data["size"] = static_cast<Json::Int64>(content.size());
            data["eol"] = (content.find("\r\n") != std::string::npos) ? "crlf" : "lf";
            data["content_hash"] = contentHash(content);
            data["modified_at"] = data["content_hash"];
            if (!since.empty() && since == data["content_hash"].asString()) {
                data["changed"] = false;
                data["content"] = "";
                return successResponse(singleItemArray(data), "이미 받은 내용이 최신입니다.");
            }
            return successResponse(singleItemArray(data), "현재 작업 트리 파일을 조회했습니다.");
        }

        // 1) 어느 버전을 읽을지 정한다.
        //    - index: 그 브랜치 worktree 의 인덱스. clone 이 아니라 worktree 에 있으므로 상태·스테이징과
        //      같은 경로 해석(resolveWorkDir)을 쓴다.
        //    - 그 밖: 브랜치 tip(= HEAD)의 커밋된 내용.
        //    인덱스는 일부러 flush 하지 않는다 — "스테이징 이후 무엇을 더 바꿨는가"를 보려면
        //    스테이징 시점 내용이 그대로 남아 있어야 한다.
        const bool wantIndex = (refKind == "index");
        const bool wantHead = refKind.empty() || refKind == "head";

        std::string readDir = localPath;
        std::string spec;
        std::string refLabel;
        if (wantIndex) {
            std::string workDir;
            HttpResponsePtr failure;
            if (!resolveWorkDir(requester, repoRow, branch, workDir, failure)) {
                return failure;
            }
            readDir = workDir;
            spec = ":" + path; // 빈 tree-ish = 인덱스
            refLabel = "index";
        } else if (wantHead) {
            refLabel = resolveTreeish(localPath, requested);
            if (refLabel.empty()) {
                return errorResponse("P0801", "브랜치를 찾을 수 없습니다: " + requested, k404NotFound);
            }
            spec = treeishOf(refLabel, path);
        } else {
            // 임의 rev — 커밋 SHA 와 원격 추적 참조가 여기로 온다.
            // clone 의 객체 저장소만 보면 되므로(readDir = localPath) clone 디렉터리에서 읽는다.
            refLabel = resolveRev(localPath, refKind);
            if (refLabel.empty()) {
                return errorResponse("P0801", "그 버전을 찾을 수 없습니다: " + refKind, k404NotFound);
            }
            spec = treeishOf(refLabel, path);
        }

        // 2) 캐시 검증 토큰. HEAD 쪽은 그 경로의 마지막 커밋 시각이고, 인덱스는 커밋 시각이 없으므로
        //    스테이징된 blob 해시를 쓴다(내용이 같으면 해시도 같다). 인덱스는 여기서 존재 여부도 본다 —
        //    인덱스에 없으면(새 파일을 스테이징하지 않았거나 삭제를 스테이징했거나) "그 버전에 없음"이 정답이다.
        std::string version;
        if (wantIndex) {
            auto ls = GitRunner::run(readDir, {"ls-files", "-s", "--", path});
            if (ls.ok()) {
                const std::string line = trim(ls.out);
                const std::size_t first = line.find(' ');
                if (first != std::string::npos) {
                    const std::size_t second = line.find(' ', first + 1);
                    version = line.substr(first + 1, (second == std::string::npos) ? std::string::npos : second - first - 1);
                }
            }
            if (version.empty()) {
                return errorResponse("P0801", "인덱스에 없는 파일입니다: " + path, k404NotFound);
            }
        } else if (wantHead) {
            // HEAD 쪽은 그 경로의 마지막 커밋 시각이 곧 버전이다(브랜치가 움직이면 바뀐다).
            auto logResult = GitRunner::run(localPath, {"log", "-1", "--format=%cI", refLabel, "--", path});
            version = logResult.ok() ? trim(logResult.out) : "";
        } else {
            // 임의 rev 는 확정된 SHA 자체가 버전이다 — 그 내용은 절대 변하지 않는다.
            auto resolved = GitRunner::resolveRef(localPath, refLabel);
            version = resolved.ok() ? trim(resolved.out) : refLabel;
        }

        // 캐시 검증: 클라이언트가 들고 있는 값과 같으면 버전이 바뀌지 않았다는 뜻이므로 내용을 생략한다.
        if (!since.empty() && !version.empty() && since == version) {
            Json::Value unchanged;
            unchanged["repo_id"] = repoId;
            unchanged["branch"] = refLabel;
            unchanged["path"] = path;
            unchanged["changed"] = false;
            unchanged["modified_at"] = version;
            return successResponse(singleItemArray(unchanged), "이미 받은 내용이 최신입니다.");
        }

        // 3) 존재·크기 확인
        auto sizeResult = GitRunner::run(readDir, {"cat-file", "-s", spec});
        if (!sizeResult.ok()) {
            return errorResponse("P0801", "파일을 찾을 수 없습니다: " + path, k404NotFound);
        }
        long long size = 0;
        try {
            size = std::stoll(trim(sizeResult.out));
        } catch (const std::exception &) {
            size = 0;
        }

        Json::Value data;
        data["repo_id"] = repoId;
        data["branch"] = refLabel;
        data["path"] = path;
        data["size"] = static_cast<Json::Int64>(size);
        data["encoding"] = "utf-8";
        data["read_only"] = false;
        data["content"] = "";
        data["changed"] = true;
        data["modified_at"] = version;

        // 4) 동시 편집 상한(512KB) 초과는 읽기 전용. 읽기 전용 열람 상한(4MB) 안이면 내용을
        //    그대로 실어 보낸다 — 그래야 큰 텍스트 파일도 diff와 앱의 "저장소 자세히 보기" 가
        //    내용을 보여 줄 수 있다. 널 바이트가 있으면(바이너리) JSON 문자열로 실을 수 없고, 상한을
        //    넘으면 실어 봐야 쓸모가 없으므로 그때만 내용을 빼고 크기만 알린다(content_omitted).
        if (size > kMaxTextFileBytes) {
            data["read_only"] = true;
            data["reason"] = "too_large";

            if (size <= kMaxReadOnlyFileBytes) {
                auto large = GitRunner::run(readDir, {"show", spec});
                if (large.ok()) {
                    if (large.out.find('\0') == std::string::npos) {
                        data["content"] = large.out;
                        data["eol"] = (large.out.find("\r\n") != std::string::npos) ? "crlf" : "lf";
                        data["content_hash"] = contentHash(large.out);
                        return successResponse(singleItemArray(data), "파일이 커서 동시 편집은 지원하지 않습니다. 내용은 읽기 전용으로 볼 수 있습니다.");
                    }

                    // 널 바이트가 있으면(바이너리) JSON 문자열로 실을 수 없다 — 크기만 알린다.
                    data["reason"] = "binary";
                    data["encoding"] = "binary";
                    data["content_omitted"] = true;
                    data["content_hash"] = contentHash(large.out);
                    return successResponse(singleItemArray(data), "바이너리 파일이라 읽기 전용으로 표시했습니다.");
                }
            }

            data["content_omitted"] = true;
            return successResponse(singleItemArray(data), "파일이 너무 커서 읽기 전용으로 표시했습니다.");
        }

        auto content = GitRunner::run(readDir, {"show", spec});
        if (!content.ok()) {
            return errorResponse("P0801", "파일 내용을 읽지 못했습니다: " + path, k500InternalServerError);
        }

        // 5) 바이너리(NUL 포함)도 읽기 전용
        if (content.out.find('\0') != std::string::npos) {
            data["read_only"] = true;
            data["reason"] = "binary";
            data["encoding"] = "binary";
            // 내용을 싣지 않았다 — diff의 왼쪽과 앱 미리보기가 이 표시로 판단한다.
            data["content_omitted"] = true;
            data["content_hash"] = contentHash(content.out);
            return successResponse(singleItemArray(data), "바이너리 파일이라 읽기 전용으로 표시했습니다.");
        }

        data["content"] = content.out;
        data["eol"] = (content.out.find("\r\n") != std::string::npos) ? "crlf" : "lf";
        data["content_hash"] = contentHash(content.out);
        return successResponse(singleItemArray(data), "파일을 조회했습니다.");
    });
}

// GET /api/github/repos/workspace?repo_id=1&branch=main — AI 작업공간용 브랜치 스냅샷.
// worktree 의 추적·untracked 텍스트 파일을 JSON 으로 한 번에 내려준다. .git 자체는 보내지 않고,
// 확장이 로컬에서 baseline Git 을 초기화한다. 비밀값이 들어가기 쉬운 파일과 바이너리는 제외한다.
void GithubController::getRepositoryWorkspace(const HttpRequestPtr &req,
                                              std::function<void(const HttpResponsePtr &)> &&callback) {
    int repoId = 0;
    if (!parseInt(req->getParameter("repo_id"), repoId)) {
        callback(errorResponse("400", "필수 파라미터(repo_id)가 누락되었거나 올바르지 않습니다.", k400BadRequest));
        return;
    }

    const std::string requestedBranch = trim(req->getParameter("branch"));
    const std::string requester = requesterEmail(req);
    runOffLoop(req, std::move(callback), [requester, repoId, requestedBranch]() -> HttpResponsePtr {
        std::string workDir;
        HttpResponsePtr failure;
        if (!resolveWorkDir(requester, repoId, requestedBranch, workDir, failure)) {
            return failure;
        }

        std::lock_guard<std::mutex> guard(*repoLock(repoId));

        // 아직 파일로 내려가지 않은 Yjs 편집도 스냅샷에 포함한다.
        auto branchResult = GitRunner::currentBranch(workDir);
        const std::string branch = branchResult.ok() ? trim(branchResult.out) : requestedBranch;
        flushCollabDocs(repoId, branch);

        auto listed = GitRunner::lsFiles(workDir, {"--cached", "--others", "--exclude-standard"});
        if (!listed.ok()) {
            return errorResponse("P0807", "작업공간 파일 목록을 읽지 못했습니다: " + trim(listed.err),
                                 k500InternalServerError);
        }

        const std::vector<std::string> nested = nestedWorktreePaths(workDir);
        Json::Value files(Json::arrayValue);
        Json::Value skipped(Json::arrayValue);
        long long totalBytes = 0;
        int included = 0;
        int skippedCount = 0;

        auto skip = [&skipped, &skippedCount](const std::string &path, const std::string &reason) {
            if (skippedCount >= 200) {
                return;
            }
            Json::Value item;
            item["path"] = path;
            item["reason"] = reason;
            skipped.append(item);
            ++skippedCount;
        };

        for (const std::string &rawPath : splitNul(listed.out)) {
            const std::string path = normalizePath(rawPath);
            if (path.empty() || !isSafeRelPath(path)) {
                continue;
            }
            if (path == ".axis" || path.rfind(".axis/", 0) == 0 || path.rfind(".worktrees/", 0) == 0) {
                continue;
            }

            bool nestedPath = false;
            for (const std::string &root : nested) {
                if (pathCovers(root, path)) {
                    nestedPath = true;
                    break;
                }
            }
            if (nestedPath) {
                continue;
            }

            if (isSensitiveAiWorkspacePath(path)) {
                skip(path, "sensitive");
                continue;
            }
            if (hasSymlinkParent(workDir, path)) {
                skip(path, "symlink");
                continue;
            }
            if (included >= kMaxAiWorkspaceFiles) {
                skip(path, "file_limit");
                continue;
            }

            std::string content;
            std::string reason;
            if (!readTextFileLimited(worktreeAbsPath(workDir, path), kMaxAiWorkspaceFileBytes, content, reason)) {
                skip(path, reason);
                continue;
            }
            if (totalBytes + static_cast<long long>(content.size()) > kMaxAiWorkspaceTotalBytes) {
                skip(path, "size_limit");
                continue;
            }

            Json::Value file;
            file["path"] = path;
            file["content"] = content;
            file["encoding"] = "utf-8";
            file["hash"] = contentHash(content);
            file["version"] = aiWorkspaceVersion(worktreeAbsPath(workDir, path));
            files.append(file);
            totalBytes += static_cast<long long>(content.size());
            ++included;
        }

        Json::Value data;
        data["repo_id"] = repoId;
        data["branch"] = branch;
        auto head = GitRunner::headSha(workDir);
        data["head_sha"] = head.ok() ? trim(head.out) : "";
        data["file_count"] = included;
        data["total_bytes"] = static_cast<Json::Int64>(totalBytes);
        data["truncated"] = skippedCount > 0;
        data["files"] = files;
        data["skipped"] = skipped;
        return successResponse(singleItemArray(data), "AI 작업공간 스냅샷을 만들었습니다.");
    });
}

// GET /api/github/repos/workspace/manifest?repo_id=1&branch=main
// AI 작업공간 최초 동기화용 경량 manifest. 파일 본문을 JSON 으로 싣지 않고
// path/size/version 만 돌려준다. 확장은 로컬 캐시와 비교해 바뀐 파일만 개별 조회한다.
void GithubController::getRepositoryWorkspaceManifest(const HttpRequestPtr &req,
                                                      std::function<void(const HttpResponsePtr &)> &&callback) {
    int repoId = 0;
    if (!parseInt(req->getParameter("repo_id"), repoId)) {
        callback(errorResponse("400", "필수 파라미터(repo_id)가 없거나 잘못되었습니다.", k400BadRequest));
        return;
    }

    const std::string requestedBranch = trim(req->getParameter("branch"));
    const std::string requester = requesterEmail(req);
    runOffLoop(req, std::move(callback), [requester, repoId, requestedBranch]() -> HttpResponsePtr {
        std::string workDir;
        HttpResponsePtr failure;
        if (!resolveWorkDir(requester, repoId, requestedBranch, workDir, failure)) {
            return failure;
        }

        std::lock_guard<std::mutex> guard(*repoLock(repoId));

        auto branchResult = GitRunner::currentBranch(workDir);
        const std::string branch = branchResult.ok() ? trim(branchResult.out) : requestedBranch;
        flushCollabDocs(repoId, branch);

        AiWorkspaceCollection collection;
        std::string collectError;
        if (!collectAiWorkspaceFiles(workDir, collection, collectError)) {
            return errorResponse("P0807", "작업공간 파일 목록을 읽지 못했습니다: " + collectError,
                                 k500InternalServerError);
        }

        Json::Value files(Json::arrayValue);
        for (const AiWorkspaceEntry &entry : collection.files) {
            Json::Value file;
            file["path"] = entry.path;
            file["size"] = static_cast<Json::Int64>(entry.size);
            file["version"] = entry.version;
            files.append(file);
        }

        Json::Value data;
        data["repo_id"] = repoId;
        data["branch"] = branch;
        auto head = GitRunner::headSha(workDir);
        data["head_sha"] = head.ok() ? trim(head.out) : "";
        data["file_count"] = static_cast<int>(collection.files.size());
        data["total_bytes"] = static_cast<Json::Int64>(collection.totalBytes);
        data["truncated"] = collection.skippedCount > 0;
        data["complete"] = collection.complete;
        data["files"] = files;
        data["skipped"] = collection.skipped;
        return successResponse(singleItemArray(data), "AI 작업공간 manifest 를 만들었습니다.");
    });
}

// GET /api/github/repos/workspace/archive?repo_id=1&branch=main
// AI 작업공간 최초 동기화용 tar.gz. 파일별 API 왕복을 없애 큰 저장소의 첫 다운로드 시간을 줄인다.
// 이후 증분 동기화는 기존 manifest + 파일별 조회를 그대로 쓴다.
void GithubController::getRepositoryWorkspaceArchive(const HttpRequestPtr &req,
                                                     std::function<void(const HttpResponsePtr &)> &&callback) {
    int repoId = 0;
    if (!parseInt(req->getParameter("repo_id"), repoId)) {
        callback(errorResponse("400", "필수 파라미터(repo_id)가 없거나 잘못되었습니다.", k400BadRequest));
        return;
    }

    const std::string requestedBranch = trim(req->getParameter("branch"));
    const std::string requester = requesterEmail(req);
    runOffLoop(req, std::move(callback), [requester, repoId, requestedBranch]() -> HttpResponsePtr {
        std::string workDir;
        HttpResponsePtr failure;
        if (!resolveWorkDir(requester, repoId, requestedBranch, workDir, failure)) {
            return failure;
        }

        std::lock_guard<std::mutex> guard(*repoLock(repoId));

        auto branchResult = GitRunner::currentBranch(workDir);
        const std::string branch = branchResult.ok() ? trim(branchResult.out) : requestedBranch;
        flushCollabDocs(repoId, branch);

        std::string archive;
        std::string error;
        if (!buildAiWorkspaceArchive(workDir, archive, error)) {
            return errorResponse("P0807", "AI 작업공간 압축을 만들지 못했습니다: " + error,
                                 k500InternalServerError);
        }

        auto resp = HttpResponse::newHttpResponse();
        resp->setStatusCode(k200OK);
        resp->setContentTypeString("application/gzip");
        resp->addHeader("Content-Disposition", "attachment; filename=axis-workspace.tar.gz");
        resp->addHeader("Cache-Control", "no-store");
        resp->setBody(std::move(archive));
        return resp;
    });
}

// PUT /api/github/repos/file — CAS 기반 파일 쓰기.
// 기대 해시가 현재 worktree 내용과 다르면 덮어쓰지 않고 P0816 으로 충돌을 알린다.
// 파일 쓰기 뒤에는 열려 있는 Yjs 문서도 같은 내용으로 맞춰 다른 사용자 화면에 즉시 반영한다.
void GithubController::updateRepositoryFile(const HttpRequestPtr &req,
                                            std::function<void(const HttpResponsePtr &)> &&callback) {
    auto jsonPtr = req->getJsonObject();
    const bool deleted = jsonPtr && jsonPtr->isMember("deleted") && (*jsonPtr)["deleted"].isBool() &&
                         (*jsonPtr)["deleted"].asBool();
    if (!jsonPtr || !validateInts(jsonPtr, "repo_id") || !validateStrings(jsonPtr, "branch", "path") ||
        (!deleted && (!jsonPtr->isMember("content") || !(*jsonPtr)["content"].isString()))) {
        callback(errorResponse("400", "필수 파라미터(repo_id, branch, path, content 또는 deleted)가 누락되었습니다.",
                               k400BadRequest));
        return;
    }

    const int repoId = (*jsonPtr)["repo_id"].asInt();
    const std::string branch = trim((*jsonPtr)["branch"].asString());
    const std::string path = normalizePath((*jsonPtr)["path"].asString());
    const std::string content = deleted ? std::string() : (*jsonPtr)["content"].asString();
    std::string expectedHash = (*jsonPtr).isMember("expected_hash") && (*jsonPtr)["expected_hash"].isString()
                                   ? trim((*jsonPtr)["expected_hash"].asString())
                                   : std::string();
    if (expectedHash.rfind("sha256:", 0) == 0) {
        expectedHash = expectedHash.substr(7);
    }
    if (branch.empty() || !isSafeRelPath(path)) {
        callback(errorResponse("400", "경로 또는 브랜치가 올바르지 않습니다.", k400BadRequest));
        return;
    }
    if (path == ".worktrees" || path.rfind(".worktrees/", 0) == 0) {
        callback(errorResponse("400", "예약된 작업 디렉터리에는 쓸 수 없습니다.", k400BadRequest));
        return;
    }
    if (isSensitiveAiWorkspacePath(path)) {
        callback(errorResponse("400", "자격 증명이 들어가기 쉬운 파일에는 AI 가 쓸 수 없습니다.", k400BadRequest));
        return;
    }
    if (!expectedHash.empty() && !isSha256Hex(expectedHash)) {
        callback(errorResponse("400", "expected_hash 형식이 올바르지 않습니다.", k400BadRequest));
        return;
    }
    if (!deleted && content.find('\0') != std::string::npos) {
        callback(errorResponse("P0815", "NUL 바이트가 있는 바이너리 내용은 AI가 쓸 수 없습니다.",
                               k400BadRequest));
        return;
    }
    if (!deleted && static_cast<long long>(content.size()) > kMaxTextFileBytes) {
        callback(errorResponse("P0815", "AI가 쓸 수 있는 파일 크기 상한을 넘었습니다.",
                               k413RequestEntityTooLarge));
        return;
    }

    const std::string requester = requesterEmail(req);
    runOffLoop(req, std::move(callback), [requester, repoId, branch, path, content, expectedHash, deleted]() -> HttpResponsePtr {
        std::string workDir;
        HttpResponsePtr failure;
        if (!resolveWorkDir(requester, repoId, branch, workDir, failure, true)) {
            return failure;
        }
        if (hasSymlinkParent(workDir, path)) {
            return errorResponse("P0807", "심볼릭 링크를 거치는 경로에는 쓸 수 없습니다: " + path, k400BadRequest);
        }

        std::lock_guard<std::mutex> guard(*repoLock(repoId));
        flushCollabDocs(repoId, branch);

        const std::string target = worktreeAbsPath(workDir, path);
        std::error_code ec;
        const auto status = std::filesystem::symlink_status(target, ec);
        if (ec && ec != std::errc::no_such_file_or_directory) {
            return errorResponse("P0807", "파일 상태를 확인하지 못했습니다: " + path, k500InternalServerError);
        }
        const bool exists = !ec && std::filesystem::exists(status);
        if (exists && !std::filesystem::is_regular_file(status)) {
            return errorResponse("P0816", "일반 파일이 아니어서 덮어쓸 수 없습니다: " + path, k409Conflict);
        }

        if (deleted) {
            if (!exists) {
                Json::Value data;
                data["path"] = path;
                data["deleted"] = true;
                data["already_absent"] = true;
                return successResponse(singleItemArray(data), "이미 없는 파일입니다.");
            }

            std::string current;
            std::string reason;
            if (!readFileBytesLimited(target, kMaxReadOnlyFileBytes, current, reason)) {
                Json::Value data;
                data["path"] = path;
                data["reason"] = reason;
                data["current_hash"] = "";
                return errorResponse("P0816", "현재 파일을 안전하게 비교할 수 없습니다: " + path, k409Conflict, data);
            }

            const std::string currentHash = sha256Hex(current);
            if (expectedHash.empty() || expectedHash != currentHash) {
                Json::Value data;
                data["path"] = path;
                data["current_hash"] = "sha256:" + currentHash;
                if (current.find('\0') == std::string::npos &&
                    static_cast<long long>(current.size()) <= kMaxTextFileBytes) {
                    data["current_content"] = current;
                }
                return errorResponse("P0816", "파일이 그 사이 변경되었습니다. 다시 읽고 삭제해 주세요.", k409Conflict, data);
            }

            // HEAD 에 없는 새 파일이면 intent-to-add / staged 항목도 같이 지운다. 그러지 않으면
            // 파일은 사라졌는데 Changes 에 '추가됨' 항목만 남는다.
            const bool trackedInHead = GitRunner::run(workDir, {"cat-file", "-e", "HEAD:" + path}).ok();
            std::filesystem::remove(target, ec);
            if (ec) {
                return errorResponse("P0807", "파일을 삭제하지 못했습니다: " + path, k500InternalServerError);
            }
            if (!trackedInHead) {
                auto unstaged = GitRunner::run(workDir, {"reset", "--", path});
                if (!unstaged.ok()) {
                    LOG_WARN << "삭제한 새 파일의 인덱스 정리 실패 (" << path << "): " << trim(unstaged.err);
                }
            }

            dropCollabDocs(repoId, branch, {path});
            broadcastTreeChanged(repoId, branch, "file_deleted", path);
            broadcastStatusChanged(repoId, branch);

            Json::Value data;
            data["path"] = path;
            data["deleted"] = true;
            return successResponse(singleItemArray(data), "파일을 삭제했습니다.");
        }

        // expected_hash 가 있는데 파일이 사라졌다면 다른 사용자가 먼저 삭제한 것이다.
        // 새 파일로 되살리지 말고 충돌을 돌려 AI 가 최신 상태를 다시 읽게 한다.
        if (!exists && !expectedHash.empty()) {
            Json::Value data;
            data["path"] = path;
            data["current_hash"] = "";
            data["already_absent"] = true;
            return errorResponse("P0816", "기대한 파일이 이미 삭제되었습니다. 최신 상태를 다시 확인해 주세요.",
                                 k409Conflict, data);
        }

        std::string current;
        std::string reason;
        if (exists && !readTextFileLimited(target, kMaxReadOnlyFileBytes, current, reason)) {
            Json::Value data;
            data["path"] = path;
            data["reason"] = reason;
            data["current_hash"] = "";
            return errorResponse("P0816", "현재 파일을 안전하게 비교할 수 없습니다: " + path, k409Conflict, data);
        }

        const std::string currentHash = sha256Hex(current);
        if (exists && expectedHash.empty()) {
            Json::Value data;
            data["path"] = path;
            data["current_hash"] = "sha256:" + currentHash;
            data["current_content"] = current;
            return errorResponse("P0816", "기존 파일을 덮어쓰려면 expected_hash 가 필요합니다.", k409Conflict, data);
        }
        if (!expectedHash.empty() && expectedHash != currentHash) {
            Json::Value data;
            data["path"] = path;
            data["current_hash"] = "sha256:" + currentHash;
            data["current_content"] = current;
            return errorResponse("P0816", "파일이 그 사이 변경되었습니다. 다시 읽고 수정해 주세요.", k409Conflict, data);
        }

        const std::string parentReason = ensureParentDir(target);
        if (!parentReason.empty()) {
            return errorResponse("P0807", "상위 디렉터리를 만들지 못했습니다: " + parentReason,
                                 k500InternalServerError);
        }

        std::string suffix;
        generateSecureToken(suffix);
        const std::string temp = target + ".axis-tmp-" + suffix;
        {
            std::ofstream output(temp, std::ios::binary | std::ios::trunc);
            if (!output) {
                return errorResponse("P0807", "임시 파일을 만들지 못했습니다: " + path, k500InternalServerError);
            }
            output.write(content.data(), static_cast<std::streamsize>(content.size()));
            if (!output) {
                std::filesystem::remove(temp, ec);
                return errorResponse("P0807", "파일 내용을 쓰지 못했습니다: " + path, k500InternalServerError);
            }
        }

        std::filesystem::rename(temp, target, ec);
        if (ec) {
            std::filesystem::remove(temp, ec);
            return errorResponse("P0807", "파일을 교체하지 못했습니다: " + path, k500InternalServerError);
        }

        if (!exists) {
            auto intent = GitRunner::run(workDir, {"add", "-N", "--", path});
            if (!intent.ok()) {
                LOG_WARN << "AI 파일 intent-to-add 실패 (" << path << "): " << trim(intent.err);
            }
        }

        Json::Value resetFiles(Json::arrayValue);
        Json::Value resetFile;
        resetFile["path"] = path;
        // Yjs 텍스트는 LF 고정이다. CRLF 파일을 그대로 넣으면 다음 flush 가 줄을 중복시킨다.
        resetFile["text"] = toLf(content);
        resetFiles.append(resetFile);
        resetCollabDocs(repoId, branch, resetFiles);

        if (!exists) {
            broadcastTreeChanged(repoId, branch, "file_created", path);
        } else {
            // 기존 파일 내용이 바뀐 경우에는 트리 모양이 그대로라 worktree_changed 로 알린다.
            // 확장은 이 경로만 다시 받아 AI 작업공간을 최신으로 맞춘다.
            broadcastWorktreeChanged(repoId, branch, {path});
        }
        broadcastStatusChanged(repoId, branch);

        Json::Value data;
        data["path"] = path;
        data["content_hash"] = contentHash(content);
        data["size"] = static_cast<Json::Int64>(content.size());
        data["created"] = !exists;
        return successResponse(singleItemArray(data), exists ? "파일을 안전하게 갱신했습니다." : "파일을 만들었습니다.");
    });
}

// GET /api/github/repos/patch?repo_id=1&branch=main&mode=working|staged — MCP diff 도구용 통합 diff.
void GithubController::getRepositoryPatch(const HttpRequestPtr &req,
                                          std::function<void(const HttpResponsePtr &)> &&callback) {
    int repoId = 0;
    if (!parseInt(req->getParameter("repo_id"), repoId)) {
        callback(errorResponse("400", "필수 파라미터(repo_id)가 누락되었거나 올바르지 않습니다.", k400BadRequest));
        return;
    }

    const std::string branch = trim(req->getParameter("branch"));
    const std::string mode = trim(req->getParameter("mode")).empty() ? "working" : trim(req->getParameter("mode"));
    const std::string path = normalizePath(req->getParameter("path"));
    if (mode != "working" && mode != "staged") {
        callback(errorResponse("400", "mode 는 working 또는 staged 여야 합니다.", k400BadRequest));
        return;
    }
    if (!path.empty() && !isSafeRelPath(path)) {
        callback(errorResponse("400", "경로가 올바르지 않습니다: " + path, k400BadRequest));
        return;
    }

    const std::string requester = requesterEmail(req);
    runOffLoop(req, std::move(callback), [requester, repoId, branch, mode, path]() -> HttpResponsePtr {
        std::string workDir;
        HttpResponsePtr failure;
        if (!resolveWorkDir(requester, repoId, branch, workDir, failure)) {
            return failure;
        }

        if (mode == "working") {
            auto current = GitRunner::currentBranch(workDir);
            flushCollabDocs(repoId, current.ok() ? trim(current.out) : branch);
        }

        std::vector<std::string> args = {"diff", "--no-ext-diff", "--no-color", "--unified=3"};
        if (mode == "staged") {
            args.push_back("--cached");
        }
        if (!path.empty()) {
            args.push_back("--");
            args.push_back(path);
        }

        auto result = GitRunner::run(workDir, args);
        if (!result.ok()) {
            return errorResponse("P0807", "diff 를 만들지 못했습니다: " + trim(result.err), k500InternalServerError);
        }

        bool truncated = false;
        std::string patch = result.out;
        if (static_cast<long long>(patch.size()) > kMaxPatchBytes) {
            patch.resize(static_cast<std::size_t>(kMaxPatchBytes));
            truncated = true;
        }

        Json::Value data;
        data["mode"] = mode;
        data["path"] = path;
        data["patch"] = patch;
        data["truncated"] = truncated;
        return successResponse(singleItemArray(data), "diff 를 만들었습니다.");
    });
}

// GET /api/github/repos/diff?repo_id=1&base=<rev>&target=<rev> — 두 버전 사이에 바뀐 파일 목록
// Graph 뷰가 커밋(부모 → 커밋)이나 원격(origin/<branch> → HEAD)을 펼칠 때 쓴다.
// 여기서는 목록만 만든다 — 파일마다 GET /api/github/repos/file?ref=<rev> 로 양쪽 내용을 받아
// VS Code 내장 diff 가 비교하는 것이 4·5번의 방식이다(서버는 diff 텍스트를 만들지 않는다).
// base 가 비면 첫 커밋(root)으로 보고 빈 트리와 비교한다 — 전부 추가로 보인다.
void GithubController::getRepositoryRange(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    int repoId = 0;
    if (!parseInt(req->getParameter("repo_id"), repoId)) {
        callback(errorResponse("400", "필수 파라미터(repo_id)가 누락되었거나 올바르지 않습니다.", k400BadRequest));
        return;
    }

    const std::string base = trim(req->getParameter("base"));
    const std::string target = trim(req->getParameter("target"));
    if (target.empty() || !isValidRev(target) || (!base.empty() && !isValidRev(base))) {
        callback(errorResponse("400", "필수 파라미터(base|target)가 올바르지 않습니다.", k400BadRequest));
        return;
    }

    const std::string requester = requesterEmail(req);
    runOffLoop(req, std::move(callback), [requester, repoId, base, target]() -> HttpResponsePtr {
        auto db = app().getDbClient();
        Json::Value repoRow;
        if (!singleRow(db->execSqlSync("SELECT * FROM get_github_repository_by_id($1, $2)", requester, repoId), repoRow)) {
            return errorResponse("P0801", "연결된 저장소를 찾을 수 없습니다.", k404NotFound);
        }

        const std::string localPath = repoRow["local_path"].asString();

        // 1) 두 끝을 clone 안의 실제 tree-ish 로 확정한다. base 가 비면 root 커밋이다(빈 트리와 비교).
        const std::string leftRev = base.empty() ? std::string(kEmptyTreeSha) : resolveRev(localPath, base);
        const std::string rightRev = resolveRev(localPath, target);
        if (leftRev.empty()) {
            return errorResponse("P0801", "그 버전을 찾을 수 없습니다: " + base, k404NotFound);
        }
        if (rightRev.empty()) {
            return errorResponse("P0801", "그 버전을 찾을 수 없습니다: " + target, k404NotFound);
        }

        // 2) 이름과 상태만 받는다 — 내용은 파일 단위 조회로 따로 온다. -z 로 경로를 NUL 구분해
        //    공백·개행이 있는 파일명도 안전하다(이름변경은 'R100\0<from>\0<to>\0' 순서).
        //    --find-renames 는 저장소 설정에 기대지 않으려고 명시한다.
        auto diff = GitRunner::run(localPath, {"diff", "--name-status", "-z", "--find-renames", leftRev, rightRev});
        if (!diff.ok()) {
            LOG_WARN << "diff --name-status 실패 (" << leftRev << " -> " << rightRev << "): " << trim(diff.err);
            return errorResponse("P0807", "변경 목록을 읽지 못했습니다: " + trim(diff.err), k500InternalServerError);
        }

        // 3) 확장이 그대로 쓰는 [{path, state, from?}] 로 옮긴다(status 와 같은 상태 이름).
        Json::Value items(Json::arrayValue);
        const std::vector<std::string> tokens = splitNul(diff.out);
        std::size_t index = 0;
        while (index < tokens.size()) {
            const std::string code = tokens[index++];
            if (code.empty()) {
                continue;
            }

            const bool isRename = code.compare(0, 1, "R") == 0;
            const bool isCopy = code.compare(0, 1, "C") == 0;
            if (isRename || isCopy) {
                if (index + 1 >= tokens.size()) {
                    break; // 잘린 출력 — 더 볼 것이 없다
                }
                const std::string from = tokens[index++];
                const std::string to = tokens[index++];

                Json::Value item;
                item["path"] = to;
                item["state"] = isRename ? "renamed" : "copied";
                item["from"] = from;
                items.append(item);
                continue;
            }

            if (index >= tokens.size()) {
                break;
            }
            const std::string path = tokens[index++];

            std::string state;
            if (!porcelainState(code[0], state)) {
                continue; // 우리가 다루지 않는 코드(X/B 등)는 건너뛴다
            }

            Json::Value item;
            item["path"] = path;
            item["state"] = state;
            items.append(item);
        }

        return successResponse(items, "변경 목록을 조회했습니다.");
    });
}

// GET /api/github/repos/branches?repo_id=3 — 등록 브랜치 + 원격 브랜치 + 접속자
void GithubController::getBranches(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    int repoId = 0;
    if (!parseInt(req->getParameter("repo_id"), repoId)) {
        callback(errorResponse("400", "필수 파라미터(repo_id)가 누락되었거나 올바르지 않습니다.", k400BadRequest));
        return;
    }

    const std::string requester = requesterEmail(req);
    runOffLoop(req, std::move(callback), [requester, repoId]() -> HttpResponsePtr {
        auto db = app().getDbClient();

        Json::Value repoRow;
        if (!singleRow(db->execSqlSync("SELECT * FROM get_github_repository_by_id($1, $2)", requester, repoId), repoRow)) {
            return errorResponse("P0801", "연결된 저장소를 찾을 수 없습니다.", k404NotFound);
        }

        // 1) 우리가 등록한 브랜치 (접속자 목록 포함)
        Json::Value branches = rowsToArray(db->execSqlSync("SELECT * FROM get_github_branches($1, $2)", requester, repoId));
        std::vector<std::string> known;
        for (auto &branch : branches) {
            branch["is_registered"] = true;
            known.push_back(branch["name"].asString());
        }

        // 2) 아직 등록하지 않은 원격 브랜치도 합친다 (선택 시 worktree 를 만들어 준다).
        const std::string localPath = repoRow["local_path"].asString();
        const std::string defaultBranch = repoRow["default_branch"].asString();
        auto refs = GitRunner::listRefs(localPath);
        if (refs.ok()) {
            const std::string prefix = "origin/";
            for (const auto &line : splitLines(refs.out)) {
                const std::string name = trim(line);
                if (name.compare(0, prefix.size(), prefix) != 0) {
                    continue;
                }
                const std::string shortName = name.substr(prefix.size());
                if (shortName.empty() || shortName == "HEAD") {
                    continue;
                }
                if (std::find(known.begin(), known.end(), shortName) != known.end()) {
                    continue;
                }
                known.push_back(shortName);

                Json::Value node;
                node["name"] = shortName;
                node["is_default"] = (shortName == defaultBranch);
                node["is_registered"] = false;
                node["presence"] = Json::Value(Json::arrayValue);
                branches.append(node);
            }
        }

        // 기본 브랜치를 맨 앞에 두고, 그다음 이름순으로 정렬한다 (DB 순서와 원격 순서가 섞이지 않게).
        // 기본 브랜치 이름은 main/master 로 고정할 수 없다(저장소마다 다르다).
        // SQL 이 default_branch 와 비교해 넣어 준 is_default 만 보고 판단한다.
        // Json::Value 의 반복자는 양방향이라 std::sort 를 쓸 수 없다. vector 로 옮겨 정렬한 뒤 다시 배열로 만든다.
        std::vector<Json::Value> ordered(branches.begin(), branches.end());
        std::sort(ordered.begin(), ordered.end(), [](const Json::Value &a, const Json::Value &b) {
            const bool aDefault = a["is_default"].asBool();
            const bool bDefault = b["is_default"].asBool();
            if (aDefault != bDefault) {
                return aDefault;
            }
            return a["name"].asString() < b["name"].asString();
        });

        Json::Value sorted(Json::arrayValue);
        for (const auto &item : ordered) {
            sorted.append(item);
        }

        return successResponse(sorted, "브랜치 목록을 조회했습니다.");
    });
}

// GET /api/github/repos/commits?repo_id=3&branch=main&limit=50 — 커밋 그래프
// GET /api/github/repos/commits?repo_id=3&all=true&limit=200 — 저장소 전체 그래프(모든 브랜치)
// 서버 로컬 clone 의 실제 git 이력이다. 읽기 전용이라 GitHub 자격증명이 필요 없다.
void GithubController::getRepositoryCommits(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    int repoId = 0;
    if (!parseInt(req->getParameter("repo_id"), repoId)) {
        callback(errorResponse("400", "필수 파라미터(repo_id)가 누락되었거나 올바르지 않습니다.", k400BadRequest));
        return;
    }

    const std::string branch = req->getParameter("branch");

    // 저장소 전체(로컬 브랜치·원격 추적 참조·태그)를 한 번에 본다 — 익스텐션의 "저장소 전체 그래프"
    // 웹뷰가 쓴다. 값은 다른 곳과 같은 관례로 "true" 만 참으로 본다.
    const bool allRefs = req->getParameter("all") == "true";

    // 그래프 한 번 그리는 비용 = 읽는 커밋 수다. 임의로 큰 값을 막으려고 상한을 둔다.
    constexpr int kDefaultLimit = 50;
    constexpr int kMaxLimit = 200;
    int limit = kDefaultLimit;
    const std::string rawLimit = req->getParameter("limit");
    if (!rawLimit.empty() && !parseInt(rawLimit, limit)) {
        limit = kDefaultLimit;
    }
    if (limit < 1) {
        limit = 1;
    }
    if (limit > kMaxLimit) {
        limit = kMaxLimit;
    }

    const std::string requester = requesterEmail(req);
    runOffLoop(req, std::move(callback), [requester, repoId, branch, limit, allRefs]() -> HttpResponsePtr {
        auto db = app().getDbClient();
        Json::Value repoRow;
        if (!singleRow(db->execSqlSync("SELECT * FROM get_github_repository_by_id($1, $2)", requester, repoId), repoRow)) {
            return errorResponse("P0801", "연결된 저장소를 찾을 수 없습니다.", k404NotFound);
        }

        const std::string localPath = repoRow["local_path"].asString();

        // scope 는 실패 로그에 남길 "무엇을 읽으려 했는가" 다. 전체 그래프면 ref 가 없다.
        std::string scope;
        GitResult logResult;
        if (allRefs) {
            scope = "--all";
            logResult = GitRunner::logAllWithParents(localPath, limit);
        } else {
            const std::string requested = branch.empty() ? repoRow["default_branch"].asString() : branch;
            scope = resolveTreeish(localPath, requested);

            if (scope.empty()) {
                return errorResponse("P0801", "브랜치를 찾을 수 없습니다: " + requested, k404NotFound);
            }

            logResult = GitRunner::logWithParents(localPath, scope, limit);
        }

        if (!logResult.ok()) {
            LOG_WARN << "커밋 로그 조회 실패 (" << scope << "): "
                     << GitRunner::safeError(logResult);
            return errorResponse("P0807", "커밋 기록을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.",
                                 k500InternalServerError);
        }

        Json::Value items(Json::arrayValue);
        for (std::string record : splitBy(logResult.out, kRecordSeparator)) {
            // git 은 레코드 사이에 개행을 넣는다(첫 레코드 앞은 없음). 앞쪽 개행만 걷어낸다.
            while (!record.empty() && (record.front() == '\n' || record.front() == '\r')) {
                record.erase(record.begin());
            }
            if (record.empty()) {
                continue;
            }

            // %H %P %an %ae %aI %D %s — 순서가 곧 계약이다.
            const std::vector<std::string> fields = splitBy(record, kFieldSeparator);
            if (fields.size() < 7) {
                continue;
            }

            Json::Value item;
            item["sha"] = fields[0];
            item["author_name"] = fields[2];
            item["author_email"] = fields[3];
            item["authored_at"] = fields[4];
            item["subject"] = fields[6];

            // 부모가 2개 이상이면 머지 커밋이다. 클라이언트가 레인을 나누는 데 쓴다.
            Json::Value parents(Json::arrayValue);
            for (const std::string &parent : splitBy(fields[1], ' ')) {
                if (!parent.empty()) {
                    parents.append(parent);
                }
            }
            item["parents"] = parents;

            // %D 는 "HEAD -> main, origin/main, tag: v1" 형태다. 쉼표로만 나누고 조각은 그대로 둔다.
            Json::Value refs(Json::arrayValue);
            for (const std::string &decoration : splitBy(fields[5], ',')) {
                const std::string label = trim(decoration);
                if (!label.empty()) {
                    refs.append(label);
                }
            }
            item["refs"] = refs;

            items.append(item);
        }

        return successResponse(items, "커밋 기록을 조회했습니다.");
    });
}

// 사용자 GitHub 자격증명 (PAT)

// GET /api/github/credentials — 내 자격증명 상태 (토큰은 절대 넣지 않는다)
void GithubController::getCredentialStatus(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    const std::string requester = requesterEmail(req);
    runOffLoop(req, std::move(callback), [requester]() -> HttpResponsePtr {
        auto db = app().getDbClient();
        auto result = db->execSqlSync("SELECT * FROM get_github_user_credential($1)", requester);
        return successResponse(rowsToArray(result), "GitHub 자격증명 상태를 조회했습니다.");
    });
}

// POST /api/github/credentials — PAT 등록. GitHub API 로 검증한 뒤 암호화해 저장한다.
void GithubController::registerCredential(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    auto jsonPtr = req->getJsonObject();
    if (!jsonPtr || !validateStrings(jsonPtr, "token")) {
        callback(errorResponse("400", "필수 파라미터(token)가 누락되었습니다.", k400BadRequest));
        return;
    }

    const std::string requester = requesterEmail(req);
    const std::string token = (*jsonPtr)["token"].asString();
    const std::string key = credentialKey();
    if (key.empty()) {
        // fail-closed: 키가 없으면 평문으로 저장하게 되므로 등록 자체를 거부한다.
        callback(errorResponse("P0806", "서버에 GITHUB_TOKEN_KEY 가 설정되어 있지 않아 자격증명을 저장할 수 없습니다.",
                               k500InternalServerError));
        return;
    }

    // 1) GitHub API(GET /user)로 토큰을 검증하고 계정(login)·스코프를 수집한다.
    //    HttpClient 는 생성한 루프에서 호출해야 하므로, 메인 루프로 올려 생성·호출을 같은 스레드에서 한다.
    auto respond = std::make_shared<std::function<void(const HttpResponsePtr &)>>(std::move(callback));
    app().getLoop()->queueInLoop([respond, requester, token, key, req]() {
        auto client = HttpClient::newHttpClient("https://api.github.com", app().getLoop());
        auto apiReq = HttpRequest::newHttpRequest();
        apiReq->setMethod(Get);
        apiReq->setPath("/user");
        apiReq->addHeader("Authorization", "Bearer " + token);
        apiReq->addHeader("Accept", "application/vnd.github+json");
        apiReq->addHeader("X-GitHub-Api-Version", "2022-11-28");
        apiReq->addHeader("User-Agent", "axis-share");

        // client 를 캡처해 응답이 올 때까지 클라이언트가 살아 있게 한다.
        client->sendRequest(
            apiReq,
            [client, respond, requester, token, key, req](ReqResult result, const HttpResponsePtr &apiResp) {
                if (result != ReqResult::Ok || apiResp == nullptr) {
                    (*respond)(errorResponse("P0807", "GitHub API 에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.", k502BadGateway));
                    return;
                }

                const int status = static_cast<int>(apiResp->getStatusCode());
                if (status == 401) {
                    (*respond)(errorResponse("P0802", "GitHub 토큰이 유효하지 않습니다.", k401Unauthorized));
                    return;
                }
                if (status != 200) {
                    (*respond)(errorResponse("P0807", "GitHub 토큰 검증에 실패했습니다 (HTTP " + std::to_string(status) + ").", k502BadGateway));
                    return;
                }

                Json::Value profile;
                Json::Reader reader;
                reader.parse(std::string(apiResp->getBody()), profile);
                const std::string login = profile["login"].isString() ? profile["login"].asString() : "";
                if (login.empty()) {
                    (*respond)(errorResponse("P0807", "GitHub 계정 정보를 확인하지 못했습니다.", k502BadGateway));
                    return;
                }

                // 2) 스코프 확인. classic PAT 는 x-oauth-scopes 헤더를 준다.
                //    fine-grained 토큰은 헤더가 없으므로 그때는 저장만 하고 통과시킨다.
                std::string scopes;
                for (const auto &header : apiResp->getHeaders()) {
                    if (lowerCopy(header.first) == "x-oauth-scopes") {
                        scopes = header.second;
                        break;
                    }
                }
                if (!scopes.empty() && scopes.find("repo") == std::string::npos) {
                    (*respond)(errorResponse("P0803", "'repo' 스코프가 있는 토큰이 필요합니다.", k403Forbidden));
                    return;
                }

                // 3) 암호화 저장. 평문 토큰은 DB 로 넘어가지 않는다 (SQL 이 pgp_sym_encrypt 한다).
                app().getDbClient()->execSqlAsync(
                    "SELECT * FROM upsert_github_user_credential($1, $2, $3, $4, $5, $6)",
                    [respond](const orm::Result &dbResult) {
                        (*respond)(successResponse(rowsToArray(dbResult), "GitHub 자격증명을 등록했습니다.", k201Created));
                    },
                    [respond, req](const orm::DrogonDbException &e) {
                        (*respond)(dbErrorResponse(e, app_utils::requestIdOf(req)));
                    },
                    requester, login, token, key, std::string("pat"), scopes);
            });
    });
}

// DELETE /api/github/credentials — 자격증명 연결 해제(소프트 삭제 + 암호문 폐기)
void GithubController::disconnectCredential(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    const std::string requester = requesterEmail(req);
    runOffLoop(req, std::move(callback), [requester]() -> HttpResponsePtr {
        auto db = app().getDbClient();
        auto result = db->execSqlSync("SELECT * FROM delete_github_user_credential($1)", requester);
        return successResponse(rowsToArray(result), "GitHub 자격증명 연결을 해제했습니다.");
    });
}

// 브랜치 접속자 / 수명주기

// GET /api/github/repos/presence?repo_id=3 — 브랜치별 접속자
void GithubController::getPresence(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    int repoId = 0;
    if (!parseInt(req->getParameter("repo_id"), repoId)) {
        callback(errorResponse("400", "필수 파라미터(repo_id)가 누락되었거나 올바르지 않습니다.", k400BadRequest));
        return;
    }

    const std::string requester = requesterEmail(req);
    runOffLoop(req, std::move(callback), [requester, repoId]() -> HttpResponsePtr {
        auto db = app().getDbClient();
        // get_github_branches 가 저장소 존재·권한까지 확인한다.
        Json::Value branches = rowsToArray(db->execSqlSync("SELECT * FROM get_github_branches($1, $2)", requester, repoId));

        Json::Value data(Json::arrayValue);
        for (const auto &branch : branches) {
            Json::Value node;
            node["name"] = branch["name"];
            node["is_default"] = branch["is_default"];
            node["presence"] = branch["presence"].isArray() ? branch["presence"] : Json::Value(Json::arrayValue);
            data.append(node);
        }
        return successResponse(data, "브랜치별 접속자를 조회했습니다.");
    });
}

// POST /api/github/repos/branches — 브랜치 생성(+worktree)
void GithubController::createBranch(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    auto jsonPtr = req->getJsonObject();
    if (!jsonPtr || !validateInts(jsonPtr, "repo_id") || !validateStrings(jsonPtr, "name")) {
        callback(errorResponse("400", "필수 파라미터(repo_id, name)가 누락되었습니다.", k400BadRequest));
        return;
    }

    const std::string requester = requesterEmail(req);
    const int repoId = (*jsonPtr)["repo_id"].asInt();
    const std::string name = trim((*jsonPtr)["name"].asString());
    const std::string baseBranch = (*jsonPtr)["base_branch"].isString() ? trim((*jsonPtr)["base_branch"].asString()) : "";
    if (name.empty()) {
        callback(errorResponse("400", "브랜치 이름이 비어 있습니다.", k400BadRequest));
        return;
    }

    runOffLoop(req, std::move(callback), [requester, repoId, name, baseBranch]() -> HttpResponsePtr {
        auto db = app().getDbClient();

        // 1) 브랜치 행을 먼저 만든다(멱등). 저장소·권한 확인과 worktree 경로 계산은 SQL 이 맡는다.
        Json::Value branchRow;
        if (!singleRow(db->execSqlSync("SELECT * FROM create_github_branch($1, $2, $3, $4)",
                                       requester, repoId, name, baseBranch),
                       branchRow)) {
            return errorResponse("P0807", "브랜치를 만들지 못했습니다: " + name, k500InternalServerError);
        }

        Json::Value repoRow;
        if (!singleRow(db->execSqlSync("SELECT * FROM get_github_repository_by_id($1, $2)", requester, repoId), repoRow)) {
            return errorResponse("P0801", "연결된 저장소를 찾을 수 없습니다.", k404NotFound);
        }

        const std::string localPath = repoRow["local_path"].asString();
        const std::string defaultBranch = repoRow["default_branch"].asString();
        const std::string worktreePath = branchRow["worktree_path"].asString();

        // 2) worktree 를 만든다. 기본 브랜치는 clone 디렉터리 자체가 작업 트리라 만들지 않는다.
        //    (git 은 같은 브랜치를 두 worktree 에서 동시에 checkout 하는 것을 거부한다.)
        if (name != defaultBranch && !worktreeReady(worktreePath)) {
            GitRunner::Auth auth;
            const GitRunner::Auth *authPtr = nullptr;
            const std::string token = userToken(db, requester);
            if (!token.empty()) {
                auth.login = "x-access-token";
                auth.token = token;
                authPtr = &auth;
            }

            auto added = ensureWorktree(localPath, worktreePath, name, branchRow["base_branch"].asString(), authPtr);
            if (!added.ok()) {
                LOG_WARN << "worktree 생성 실패 (" << name << "): " << trim(added.err);
                // DB 행은 남긴다. 같은 요청을 다시 보내면(멱등) worktree 만 다시 만든다.
                return errorResponse("P0807", "브랜치 작업 디렉터리를 만들지 못했습니다: " + trim(added.err),
                                     k500InternalServerError);
            }
        }

        if (branchRow["is_new_branch"].asBool()) {
            notifyGithubEvent(db, repoRow["node_id"].asInt(), repoId,
                              repoRow["owner_login"].asString() + "/" + repoRow["repo_name"].asString(),
                              requester, "GITHUB_BRANCH", name, "inserted", name);
        }

        // 브랜치 생성은 같은 저장소의 모든 접속자에게 알린다.
        Json::Value created;
        created["type"] = "branch_created";
        created["repo_id"] = repoId;
        created["branch"] = name;
        GithubWebSocketController::broadcastToRepository(repoId, created);

        return successResponse(branchRow, "브랜치를 만들었습니다.", k201Created);
    });
}

// DELETE /api/github/repos/branches — 브랜치 삭제(접속자·미커밋 변경이 있으면 거부)
void GithubController::deleteBranch(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    // DELETE 는 본문을 못 쓰는 클라이언트가 있어 쿼리 파라미터도 받는다.
    Json::Value body;
    if (auto jsonPtr = req->getJsonObject()) {
        body = *jsonPtr;
    }

    int repoId = 0;
    if (body["repo_id"].isInt()) {
        repoId = body["repo_id"].asInt();
    } else if (!parseInt(req->getParameter("repo_id"), repoId)) {
        callback(errorResponse("400", "필수 파라미터(repo_id)가 누락되었거나 올바르지 않습니다.", k400BadRequest));
        return;
    }

    const std::string name = trim(body["name"].isString() ? body["name"].asString() : req->getParameter("name"));
    if (name.empty()) {
        callback(errorResponse("400", "필수 파라미터(name)가 누락되었습니다.", k400BadRequest));
        return;
    }

    // force 는 '커밋되지 않은 변경' 확인만 건너뛴다. 접속자가 있으면 force 로도 삭제하지 않는다.
    const bool force = body["force"].isBool() ? body["force"].asBool() : (req->getParameter("force") == "true");

    const std::string requester = requesterEmail(req);
    runOffLoop(req, std::move(callback), [requester, repoId, name, force]() -> HttpResponsePtr {
        auto db = app().getDbClient();

        Json::Value repoRow;
        if (!singleRow(db->execSqlSync("SELECT * FROM get_github_repository_by_id($1, $2)", requester, repoId), repoRow)) {
            return errorResponse("P0801", "연결된 저장소를 찾을 수 없습니다.", k404NotFound);
        }
        const std::string localPath = repoRow["local_path"].asString();
        const std::string defaultBranch = repoRow["default_branch"].asString();
        const bool isDefault = (name == defaultBranch);

        Json::Value target;
        bool found = false;
        Json::Value branches = rowsToArray(db->execSqlSync("SELECT * FROM get_github_branches($1, $2)", requester, repoId));
        for (const auto &branch : branches) {
            if (branch["name"].asString() == name) {
                target = branch;
                found = true;
                break;
            }
        }
        if (!found) {
            return errorResponse("P0801", "등록된 브랜치가 아닙니다: " + name, k404NotFound);
        }

        // 0) 기본 브랜치는 지울 수 없다. 지우면 저장소의 기준 브랜치가 사라져 clone·worktree 해석이
        //    어긋난다 — 확장도 이 브랜치는 삭제 항목으로 주지 않는다.
        if (isDefault) {
            return errorResponse("400", "기본 브랜치는 삭제할 수 없습니다: " + name, k400BadRequest);
        }

        // 1) 요청자 본인을 제외한 접속자가 있으면 거부한다 (P0809).
        //    삭제 요청자는 현재 브랜치에 접속해 있을 수밖에 없으므로, 그 외 사용자가 있을 때만 막는다.
        const Json::Value presence = target["presence"];
        Json::Value otherPresence(Json::arrayValue);
        if (presence.isArray()) {
            const std::string requesterLower = lowerCopy(trim(requester));
            for (const auto &person : presence) {
                const std::string email =
                    lowerCopy(trim(person["email"].isString() ? person["email"].asString() : ""));
                if (email != requesterLower) {
                    otherPresence.append(person);
                }
            }
        }
        if (!otherPresence.empty()) {
            return errorResponse("P0809", "이 브랜치에서 작업 중인 다른 사용자가 있습니다.", k409Conflict,
                                 otherPresence);
        }

        const std::string worktreePath = target["worktree_path"].asString();

        // git 이 기억하는 실제 worktree 경로를 우선한다. DB 의 worktree_path 와 어긋난 worktree
        // (과거 상대 경로 버그로 저장소 안쪽에 만들어진 것)도 이 경로로 찾아낼 수 있다.
        std::string registeredWorktree;
        const bool hasRegisteredWorktree = findWorktreeForBranch(localPath, name, registeredWorktree);
        const std::string gitWorktreePath = hasRegisteredWorktree ? registeredWorktree : worktreePath;

        // 2) 커밋되지 않은 변경이 있으면 거부한다 (P0810). force 면 건너뛴다.
        if (!force && worktreeReady(gitWorktreePath)) {
            GitResult statusResult;
            const Json::Value entries = readWorktreeStatus(gitWorktreePath, statusResult);
            if (!statusResult.ok()) {
                return errorResponse("P0807", "브랜치 상태를 확인하지 못했습니다: " + trim(statusResult.err),
                                     k500InternalServerError);
            }
            if (!entries.empty()) {
                // 지우면 작업 디렉터리 자체가 사라진다 — 커밋하지 않은 파일도 함께 없어진다는 것을 수로 분명히 알린다.
                return errorResponse("P0810",
                                     "이 브랜치에 커밋되지 않은 변경 " + std::to_string(entries.size()) +
                                         "개(staged/modified/untracked)가 있습니다. 삭제하면 함께 사라집니다. 확인해 주세요.",
                                     k409Conflict, entries);
            }
        }

        // 3) collab 의 방·.ydoc·리뷰 인덱스를 먼저 버린다. 순서를 뒤집으면 남은 doc 의 flush 가
        //    곧 지울 작업 디렉터리를 되살리고(writeAtomic 의 mkdir), 같은 이름 브랜치를 다시 만들었을 때
        //    열기(.ydoc 우선)가 옛 내용을 복원한다.
        dropCollabBranch(repoId, name);

        // 4) 작업 디렉터리 → 로컬 브랜치 → DB 행 순서로 정리한다.
        //    worktree 를 여기서 지우지 못하면 아래 branch -d 가 'already checked out' 으로 거부당한다.
        if (hasRegisteredWorktree || worktreeReady(gitWorktreePath)) {
            auto removed = GitRunner::worktreeRemove(localPath, gitWorktreePath, force);
            if (!removed.ok()) {
                // 디렉터리만 먼저 사라지고 등록 정보가 남은 경우가 있어 prune 한 뒤 한 번 더 확인한다.
                GitRunner::run(localPath, {"worktree", "prune"});
            }
            if (worktreeReady(gitWorktreePath)) {
                LOG_WARN << "worktree 제거 실패 (" << name << "): " << trim(removed.err);
                return errorResponse("P0807", "브랜치 작업 디렉터리를 정리하지 못했습니다: " + trim(removed.err),
                                     k500InternalServerError);
            }
        }

        auto deletedLocal = GitRunner::deleteBranch(localPath, name, force);
        if (!deletedLocal.ok()) {
            // 원격에만 있고 아직 로컬 브랜치를 만들지 않은 경우엔 지울 것이 없다.
            LOG_WARN << "로컬 브랜치 삭제 건너뜀 (" << name << "): " << trim(deletedLocal.err);
        }

        auto result = db->execSqlSync("SELECT * FROM delete_github_branch($1, $2, $3)", requester, repoId, name);

        notifyGithubEvent(db, repoRow["node_id"].asInt(), repoId,
                          repoRow["owner_login"].asString() + "/" + repoRow["repo_name"].asString(),
                          requester, "GITHUB_BRANCH", name, "deleted", name);

        // 삭제 확정을 같은 저장소 전체에 알린다. 그 브랜치에 있던 사용자는 클라이언트가 기본 브랜치로 옮긴다.
        Json::Value deleted;
        deleted["type"] = "branch_deleted";
        deleted["repo_id"] = repoId;
        deleted["branch"] = name;
        deleted["default_branch"] = defaultBranch;
        GithubWebSocketController::broadcastToRepository(repoId, deleted);

        return successResponse(rowsToArray(result), "브랜치를 삭제했습니다.");
    });
}

// 작업 트리: 상태 / 스테이징 / 수동 fetch

// GET /api/github/repos/status?repo_id=3&branch=WI-101-login — 커밋 직전 상태
void GithubController::getStatus(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    int repoId = 0;
    if (!parseInt(req->getParameter("repo_id"), repoId)) {
        callback(errorResponse("400", "필수 파라미터(repo_id)가 누락되었거나 올바르지 않습니다.", k400BadRequest));
        return;
    }

    const std::string branch = trim(req->getParameter("branch"));
    if (branch.empty()) {
        callback(errorResponse("400", "필수 파라미터(branch)가 누락되었습니다.", k400BadRequest));
        return;
    }

    const std::string requester = requesterEmail(req);
    runOffLoop(req, std::move(callback), [requester, repoId, branch]() -> HttpResponsePtr {
        std::string workDir;
        HttpResponsePtr failure;
        if (!resolveWorkDir(requester, repoId, branch, workDir, failure)) {
            return failure;
        }

        GitResult statusResult;
        const Json::Value entries = readWorktreeStatus(workDir, statusResult);
        if (!statusResult.ok()) {
            return errorResponse("P0807", "작업 트리 상태를 읽지 못했습니다: " + trim(statusResult.err),
                                 k500InternalServerError);
        }
        return successResponse(entries, "작업 트리 상태를 조회했습니다.");
    });
}

// POST /api/github/repos/stage — 실제 'git add' 로 인덱스에 올린다.
// 편집은 collab 이 디바운스(기본 2초) 뒤에 파일로 내려가므로, 그 전에 누르면 디스크의 옛 내용이
// 인덱스에 올라갈 수 있다 — 그래서 add 앞에서 그 방을 강제 flush 한다.
void GithubController::stagePaths(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    auto jsonPtr = req->getJsonObject();
    if (!jsonPtr || !validateInts(jsonPtr, "repo_id") || !validateStrings(jsonPtr, "branch")) {
        callback(errorResponse("400", "필수 파라미터(repo_id, branch)가 누락되었습니다.", k400BadRequest));
        return;
    }

    const std::vector<std::string> paths = jsonStringArray((*jsonPtr)["paths"]);
    if (paths.empty()) {
        callback(errorResponse("400", "필수 파라미터(paths)가 누락되었습니다.", k400BadRequest));
        return;
    }

    const std::string requester = requesterEmail(req);
    const int repoId = (*jsonPtr)["repo_id"].asInt();
    const std::string branch = trim((*jsonPtr)["branch"].asString());
    if (branch.empty()) {
        callback(errorResponse("400", "필수 파라미터(branch)가 누락되었습니다.", k400BadRequest));
        return;
    }

    runOffLoop(req, std::move(callback), [requester, repoId, branch, paths]() -> HttpResponsePtr {
        std::string workDir;
        HttpResponsePtr failure;
        if (!resolveWorkDir(requester, repoId, branch, workDir, failure, true)) {
            return failure;
        }

        // 방금 친 내용이 아직 파일이 되지 않았을 수 있다 — 옛 내용이 인덱스에 올라가지 않게 먼저 내려쓴다.
        // collab 이 죽어 있으면 그냥 진행한다(커밋과 같은 규칙: collab 때문에 스테이징을 막지 않는다).
        flushCollabDocs(repoId, branch);

        auto staged = GitRunner::stageAdd(workDir, paths);
        if (!staged.ok()) {
            return errorResponse("P0807", "스테이징하지 못했습니다: " + trim(staged.err), k500InternalServerError);
        }

        // 인덱스가 바뀌었다 — 같은 브랜치의 다른 사용자도 Staged/Changes 그룹을 다시 그린다.
        broadcastStatusChanged(repoId, branch);

        GitResult statusResult;
        const Json::Value entries = readWorktreeStatus(workDir, statusResult);
        return successResponse(entries, "스테이징했습니다.");
    });
}

// DELETE /api/github/repos/stage — 스테이징 해제
void GithubController::unstagePaths(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    auto jsonPtr = req->getJsonObject();
    if (!jsonPtr || !validateInts(jsonPtr, "repo_id") || !validateStrings(jsonPtr, "branch")) {
        callback(errorResponse("400", "필수 파라미터(repo_id, branch)가 누락되었습니다.", k400BadRequest));
        return;
    }

    const std::vector<std::string> paths = jsonStringArray((*jsonPtr)["paths"]);
    if (paths.empty()) {
        callback(errorResponse("400", "필수 파라미터(paths)가 누락되었습니다.", k400BadRequest));
        return;
    }

    const std::string requester = requesterEmail(req);
    const int repoId = (*jsonPtr)["repo_id"].asInt();
    const std::string branch = trim((*jsonPtr)["branch"].asString());
    if (branch.empty()) {
        callback(errorResponse("400", "필수 파라미터(branch)가 누락되었습니다.", k400BadRequest));
        return;
    }

    runOffLoop(req, std::move(callback), [requester, repoId, branch, paths]() -> HttpResponsePtr {
        std::string workDir;
        HttpResponsePtr failure;
        if (!resolveWorkDir(requester, repoId, branch, workDir, failure, true)) {
            return failure;
        }

        auto unstaged = GitRunner::stageRemove(workDir, paths);
        if (!unstaged.ok()) {
            return errorResponse("P0807", "스테이징을 해제하지 못했습니다: " + trim(unstaged.err), k500InternalServerError);
        }

        // 해제도 인덱스를 바꾼다 — 같은 브랜치의 다른 사용자도 그룹을 다시 그린다.
        broadcastStatusChanged(repoId, branch);

        GitResult statusResult;
        const Json::Value entries = readWorktreeStatus(workDir, statusResult);
        return successResponse(entries, "스테이징을 해제했습니다.");
    });
}

// POST /api/github/repos/discard — 되돌리기.
// 수정한 내용을 버리고 이전(HEAD) 상태로 되돌린다. HEAD 에 없는 파일(새로 만든 파일)은 지운다.
// 되돌릴 수 없으므로 확인은 확장(UI)이 받는다. 여기서는 순서만 지킨다:
//   ① 되돌릴 내용을 정한다 → ② collab 이 열고 있는 doc 을 먼저 맞춘다 → ③ 작업 트리·인덱스를 git 으로 되돌린다.
void GithubController::discardPaths(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    auto jsonPtr = req->getJsonObject();
    if (!jsonPtr || !validateInts(jsonPtr, "repo_id") || !validateStrings(jsonPtr, "branch")) {
        callback(errorResponse("400", "필수 파라미터(repo_id, branch)가 누락되었습니다.", k400BadRequest));
        return;
    }

    const std::vector<std::string> paths = jsonStringArray((*jsonPtr)["paths"]);
    if (paths.empty()) {
        callback(errorResponse("400", "필수 파라미터(paths)가 누락되었습니다.", k400BadRequest));
        return;
    }

    const std::string requester = requesterEmail(req);
    const int repoId = (*jsonPtr)["repo_id"].asInt();
    const std::string branch = trim((*jsonPtr)["branch"].asString());
    if (branch.empty()) {
        callback(errorResponse("400", "필수 파라미터(branch)가 누락되었습니다.", k400BadRequest));
        return;
    }

    runOffLoop(req, std::move(callback), [requester, repoId, branch, paths]() -> HttpResponsePtr {
        std::string workDir;
        HttpResponsePtr failure;
        if (!resolveWorkDir(requester, repoId, branch, workDir, failure, true)) {
            return failure;
        }

        // 커밋과 같은 이유로 저장소 단위로 직렬화한다(index.lock 경합 방지).
        std::lock_guard<std::mutex> guard(*repoLock(repoId));

        // 1) 되돌릴 내용을 git 에서 먼저 읽는다. HEAD 에 있으면 그 내용, 없으면 새로 만든 파일이라 지운다.
        Json::Value files(Json::arrayValue);   // collab 에게 줄 되돌리기 목록
        std::vector<std::string> tracked;      // git restore 대상
        std::vector<std::string> fresh;        // 지울 대상(HEAD 에 없음)
        // collab 은 512KB 를 넘는 파일을 doc 으로 열지 않는다. 그런 파일은 되돌릴 doc 이 없으니
        // 통보에서도 뺀다 — 본문이 커져 내부 통보가 통째로 실패하는 편이 더 나쁘다.
        constexpr std::size_t kCollabDocLimit = 512 * 1024;
        constexpr std::size_t kResetPayloadLimit = 8 * 1024 * 1024;
        std::size_t payloadBytes = 0;

        for (const auto &path : paths) {
            auto blob = GitRunner::run(workDir, {"show", "HEAD:" + path});

            if (!blob.ok()) {
                // HEAD 에 없다 — 새로 만든 파일이라 지운다. 열려 있던 doc 도 버린다.
                fresh.push_back(path);
                Json::Value file;
                file["path"] = path;
                file["deleted"] = true;
                files.append(file);
                continue;
            }

            tracked.push_back(path);
            if (blob.out.size() > kCollabDocLimit) {
                continue; // doc 이 없는 크기다.
            }
            if (payloadBytes + blob.out.size() > kResetPayloadLimit) {
                LOG_WARN << "되돌리기 통보 payload 상한 초과. repo=" << repoId << " path=" << path;
                continue;
            }

            payloadBytes += blob.out.size();
            Json::Value file;
            file["path"] = path;
            file["text"] = toLf(blob.out);
            files.append(file);
        }

        // 2) collab 을 먼저 맞추고 끝날 때까지 기다린다. 열려 있는 doc 이 옛 텍스트를 그대로 들고 있으면
        //    다음 flush 가 되돌리기를 무르고, 늦게 도착한 그 쓰기가 아래 git 체크아웃과 겹치면 File exists 로 죽는다.
        resetCollabDocs(repoId, branch, files);

        // 3) 작업 트리와 인덱스를 되돌린다.
        for (const auto &path : tracked) {
            auto restored = GitRunner::run(workDir, {"restore", "--source=HEAD", "--staged", "--worktree", "--", path});
            if (!restored.ok()) {
                // git 체크아웃은 그 경로가 비어 있다고 본 뒤 O_CREAT|O_EXCL 로 새로 만든다(entry.c). 위에서 collab 을
                // 기다렸어도 그 사이 누가 그 경로를 만들면 File exists 로 죽는다 — 경로를 비우고 한 번 더 시도한다.
                std::error_code ignored;
                std::filesystem::remove(workDir + "/" + path, ignored);
                restored = GitRunner::run(workDir, {"restore", "--source=HEAD", "--staged", "--worktree", "--", path});
            }
            if (!restored.ok()) {
                return errorResponse("P0807", "되돌리지 못했습니다: " + trim(restored.err), k500InternalServerError);
            }
        }
        for (const auto &path : fresh) {
            // 스테이징된 새 파일이면 인덱스에서 먼저 뺀다(추적되지 않은 파일이면 실패해도 무해하다).
            GitRunner::run(workDir, {"rm", "--cached", "-q", "-f", "--", path});
            std::error_code ec;
            std::filesystem::remove(workDir + "/" + path, ec);
        }

        // 되돌리기는 파일 존재 자체를 바꾼다 — 추적 파일은 되살아나고, 새로 만든 파일은 지워진다.
        // 같은 브랜치의 다른 사용자도 트리를 즉시 다시 그리도록 경로별로 알린다.
        for (const auto &path : tracked) {
            broadcastTreeChanged(repoId, branch, "file_restored", path);
        }
        for (const auto &path : fresh) {
            broadcastTreeChanged(repoId, branch, "file_deleted", path);
        }

        // 인덱스·작업 트리가 바뀌었다 — 같은 브랜치의 다른 사용자에게도 알린다.
        broadcastStatusChanged(repoId, branch);

        GitResult statusResult;
        const Json::Value entries = readWorktreeStatus(workDir, statusResult);
        if (!statusResult.ok()) {
            return errorResponse("P0807", "작업 트리 상태를 읽지 못했습니다: " + trim(statusResult.err),
                                 k500InternalServerError);
        }
        return successResponse(entries, "되돌렸습니다.");
    });
}

// 트리 변경: 파일·디렉터리 생성 / 이름변경·이동 / 삭제
//
// 파일 시스템 변경은 서버(C++)가 수행하고 결과를 이벤트로 알린다 — 클라이언트는 요청만 하고 직접 만들지 않는다.
// 브랜치마다 작업 디렉터리(worktree)가 다르므로, 같은 요청도 브랜치마다 다른 곳에 반영된다.
//
// 공통 순서
//   ① 경로 검증(worktree 밖 탈출 금지)
//   ② collab 강제 flush — 아직 파일이 되지 않은 편집을 먼저 내려쓴다. 커밋과 같은 이유다.
//   ③ git / 파일 시스템 조작 — 추적되는 경로는 git(rm·mv)으로 인덱스까지 맞추고, untracked 는 파일만 고친다.
//   ④ collab doc 정리 — 남겨 두면 다음 flush 가 지운 파일이나 옛 경로를 되살린다.
//   ⑤ 브로드캐스트 — 같은 브랜치 접속자의 트리·변경 목록이 즉시 따라온다.
//   ⑥ 최신 작업 트리 상태를 응답으로(스테이징·되돌리기와 같은 규격)

// POST /api/github/repos/files — 빈 파일 생성
void GithubController::createFileEntry(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    auto jsonPtr = req->getJsonObject();
    if (!jsonPtr || !validateInts(jsonPtr, "repo_id") || !validateStrings(jsonPtr, "branch", "path")) {
        callback(errorResponse("400", "필수 파라미터(repo_id, branch, path)가 누락되었습니다.", k400BadRequest));
        return;
    }

    const int repoId = (*jsonPtr)["repo_id"].asInt();
    const std::string branch = trim((*jsonPtr)["branch"].asString());
    const std::string path = normalizePath((*jsonPtr)["path"].asString());
    if (branch.empty()) {
        callback(errorResponse("400", "필수 파라미터(branch)가 누락되었습니다.", k400BadRequest));
        return;
    }
    if (!isSafeRelPath(path)) {
        callback(errorResponse("400", "경로가 올바르지 않습니다: " + path, k400BadRequest));
        return;
    }

    const std::string requester = requesterEmail(req);
    runOffLoop(req, std::move(callback), [requester, repoId, branch, path]() -> HttpResponsePtr {
        std::string workDir;
        HttpResponsePtr failure;
        if (!resolveWorkDir(requester, repoId, branch, workDir, failure, true)) {
            return failure;
        }

        // 같은 저장소의 git 조작은 직렬화한다(index.lock 경합 방지).
        std::lock_guard<std::mutex> guard(*repoLock(repoId));

        if (worktreePathExists(workDir, path)) {
            return errorResponse("P0813", "이미 있는 경로입니다: " + path, k409Conflict);
        }

        // 아직 파일이 되지 않은 편집을 먼저 내려쓴 뒤에 만든다 — 순서가 뒤집히면 늦은 flush 가 빈 파일을 덮어쓴다.
        flushCollabDocs(repoId, branch);

        const std::string target = worktreeAbsPath(workDir, path);
        const std::string parentReason = ensureParentDir(target);
        if (!parentReason.empty()) {
            return errorResponse("P0807", "상위 디렉터리를 만들지 못했습니다: " + parentReason, k500InternalServerError);
        }
        {
            // 빈 파일을 만든다. 같은 요청이 겹쳐 이미 있으면 그대로 둔다.
            std::ofstream file(target, std::ios::binary | std::ios::app);
            if (!file) {
                return errorResponse("P0807", "파일을 만들지 못했습니다: " + path, k500InternalServerError);
            }
        }

        // 의도 표시(intent-to-add): 이 경로가 새 파일임을 인덱스에 알려 변경 목록에 '추가'(A) 로 뜨게 한다.
        // 스테이징은 아니므로 커밋 대상이 아니고, 실패해도 untracked 로 남을 뿐이다(트리에는 그래도 나온다).
        auto intent = GitRunner::run(workDir, {"add", "-N", "--", path});
        if (!intent.ok()) {
            LOG_WARN << "intent-to-add 실패 (" << path << "): " << trim(intent.err);
        }

        broadcastTreeChanged(repoId, branch, "file_created", path);
        broadcastStatusChanged(repoId, branch);
        return respondWithStatus(workDir, "파일을 만들었습니다.", k201Created);
    });
}

// POST /api/github/repos/dirs — 디렉터리 생성.
// git 은 빈 디렉터리를 추적하지 않으므로 그 안에 파일을 만들기 전에는 트리에 나타나지 않는다.
void GithubController::createDirectory(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    auto jsonPtr = req->getJsonObject();
    if (!jsonPtr || !validateInts(jsonPtr, "repo_id") || !validateStrings(jsonPtr, "branch", "path")) {
        callback(errorResponse("400", "필수 파라미터(repo_id, branch, path)가 누락되었습니다.", k400BadRequest));
        return;
    }

    const int repoId = (*jsonPtr)["repo_id"].asInt();
    const std::string branch = trim((*jsonPtr)["branch"].asString());
    const std::string path = normalizePath((*jsonPtr)["path"].asString());
    if (branch.empty()) {
        callback(errorResponse("400", "필수 파라미터(branch)가 누락되었습니다.", k400BadRequest));
        return;
    }
    if (!isSafeRelPath(path)) {
        callback(errorResponse("400", "경로가 올바르지 않습니다: " + path, k400BadRequest));
        return;
    }

    const std::string requester = requesterEmail(req);
    runOffLoop(req, std::move(callback), [requester, repoId, branch, path]() -> HttpResponsePtr {
        std::string workDir;
        HttpResponsePtr failure;
        if (!resolveWorkDir(requester, repoId, branch, workDir, failure, true)) {
            return failure;
        }

        std::lock_guard<std::mutex> guard(*repoLock(repoId));

        if (worktreePathExists(workDir, path)) {
            return errorResponse("P0813", "이미 있는 경로입니다: " + path, k409Conflict);
        }

        // 파일이 되지 않은 편집이 이 디렉터리 안에서 일어나고 있을 수 있다 — 먼저 내려쓴 뒤 만든다.
        flushCollabDocs(repoId, branch);

        std::error_code ec;
        std::filesystem::create_directories(worktreeAbsPath(workDir, path), ec);
        if (ec) {
            return errorResponse("P0807", "디렉터리를 만들지 못했습니다: " + ec.message(), k500InternalServerError);
        }

        broadcastTreeChanged(repoId, branch, "dir_created", path);
        return respondWithStatus(workDir, "디렉터리를 만들었습니다.", k201Created);
    });
}

// PATCH /api/github/repos/files — 이름변경·이동.
// 추적되는 경로는 git mv 로 옮겨 인덱스까지 함께 옮긴다(그래야 이름변경이 한 항목으로 보인다).
// untracked 는 파일 시스템에서 옮긴다. 어느 쪽이든 옮긴 뒤 옛 경로의 collab doc 을 버린다 —
// 남겨 두면 다음 flush 가 옛 경로를 되살린다. 새 경로는 열 때 작업 트리 파일에서 읽는다.
void GithubController::renameFileEntry(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    auto jsonPtr = req->getJsonObject();
    if (!jsonPtr || !validateInts(jsonPtr, "repo_id") || !validateStrings(jsonPtr, "branch", "from", "to")) {
        callback(errorResponse("400", "필수 파라미터(repo_id, branch, from, to)가 누락되었습니다.", k400BadRequest));
        return;
    }

    const int repoId = (*jsonPtr)["repo_id"].asInt();
    const std::string branch = trim((*jsonPtr)["branch"].asString());
    const std::string from = normalizePath((*jsonPtr)["from"].asString());
    const std::string to = normalizePath((*jsonPtr)["to"].asString());
    if (branch.empty()) {
        callback(errorResponse("400", "필수 파라미터(branch)가 누락되었습니다.", k400BadRequest));
        return;
    }
    if (!isSafeRelPath(from) || !isSafeRelPath(to)) {
        callback(errorResponse("400", "경로가 올바르지 않습니다.", k400BadRequest));
        return;
    }
    if (from == to) {
        callback(errorResponse("400", "옮기기 전후 경로가 같습니다: " + from, k400BadRequest));
        return;
    }

    const std::string requester = requesterEmail(req);
    runOffLoop(req, std::move(callback), [requester, repoId, branch, from, to]() -> HttpResponsePtr {
        std::string workDir;
        HttpResponsePtr failure;
        if (!resolveWorkDir(requester, repoId, branch, workDir, failure, true)) {
            return failure;
        }

        std::lock_guard<std::mutex> guard(*repoLock(repoId));

        if (!worktreePathExists(workDir, from)) {
            return errorResponse("P0814", "경로를 찾을 수 없습니다: " + from, k404NotFound);
        }
        if (worktreePathExists(workDir, to)) {
            return errorResponse("P0813", "이미 있는 경로입니다: " + to, k409Conflict);
        }

        // 아직 파일이 되지 않은 편집을 먼저 내려쓴다 — 그러지 않으면 옮긴 뒤 늦은 flush 가 옛 경로에 쓴다.
        flushCollabDocs(repoId, branch);

        const std::string target = worktreeAbsPath(workDir, to);
        bool moved = false;
        if (isTrackedPath(workDir, from)) {
            auto result = GitRunner::mv(workDir, from, to);
            moved = result.ok();
            if (!moved) {
                LOG_WARN << "git mv 실패 — 파일 시스템 이동으로 대체 (" << from << " → " << to << "): " << trim(result.err);
            }
        }
        if (!moved) {
            // untracked 이거나, git 이 인덱스에 없는 경로라 옮기지 못한 경우다.
            const std::string parentReason = ensureParentDir(target);
            if (!parentReason.empty()) {
                return errorResponse("P0807", "상위 디렉터리를 만들지 못했습니다: " + parentReason, k500InternalServerError);
            }

            std::error_code ec;
            std::filesystem::rename(worktreeAbsPath(workDir, from), target, ec);
            if (ec) {
                return errorResponse("P0807", "이름을 바꾸지 못했습니다: " + ec.message(), k500InternalServerError);
            }
        }

        // 옛 경로의 doc 과 .ydoc 를 버린다(디렉터리 이동이면 그 아래 전부를 collab 이 함께 정리한다).
        dropCollabDocs(repoId, branch, {from});

        broadcastTreeChanged(repoId, branch, "file_moved", to, from);
        broadcastStatusChanged(repoId, branch);
        return respondWithStatus(workDir, "이름을 바꿨습니다.");
    });
}

// DELETE /api/github/repos/files — 삭제.
// 커밋되지 않은 변경이 있으면 먼저 force 를 요구한다(브랜치 삭제와 같은 사고방식).
// 확인(모달)은 확장이 받고, 서버는 force 로만 그 확인을 건너뛴다.
void GithubController::deleteFileEntry(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    // DELETE 는 본문을 못 쓰는 클라이언트가 있어 쿼리 파라미터도 받는다(브랜치 삭제와 같은 규칙).
    Json::Value body;
    if (auto jsonPtr = req->getJsonObject()) {
        body = *jsonPtr;
    }

    int repoId = 0;
    if (body["repo_id"].isInt()) {
        repoId = body["repo_id"].asInt();
    } else if (!parseInt(req->getParameter("repo_id"), repoId)) {
        callback(errorResponse("400", "필수 파라미터(repo_id)가 누락되었거나 올바르지 않습니다.", k400BadRequest));
        return;
    }

    const std::string branch =
        trim(body["branch"].isString() ? body["branch"].asString() : req->getParameter("branch"));
    const std::string path =
        normalizePath(body["path"].isString() ? body["path"].asString() : req->getParameter("path"));
    if (branch.empty() || path.empty()) {
        callback(errorResponse("400", "필수 파라미터(branch, path)가 누락되었습니다.", k400BadRequest));
        return;
    }
    if (!isSafeRelPath(path)) {
        callback(errorResponse("400", "경로가 올바르지 않습니다: " + path, k400BadRequest));
        return;
    }

    const bool force = body["force"].isBool() ? body["force"].asBool() : (req->getParameter("force") == "true");

    const std::string requester = requesterEmail(req);
    runOffLoop(req, std::move(callback), [requester, repoId, branch, path, force]() -> HttpResponsePtr {
        std::string workDir;
        HttpResponsePtr failure;
        if (!resolveWorkDir(requester, repoId, branch, workDir, failure, true)) {
            return failure;
        }

        std::lock_guard<std::mutex> guard(*repoLock(repoId));

        if (!worktreePathExists(workDir, path)) {
            return errorResponse("P0814", "경로를 찾을 수 없습니다: " + path, k404NotFound);
        }

        // 아직 파일이 되지 않은 편집을 먼저 내려쓴 뒤 상태를 본다 — 그래야 최신 변경이 경고에 잡힌다.
        flushCollabDocs(repoId, branch);

        if (!force) {
            GitResult statusResult;
            const Json::Value entries = readWorktreeStatus(workDir, statusResult);
            if (!statusResult.ok()) {
                return errorResponse("P0807", "작업 트리 상태를 읽지 못했습니다: " + trim(statusResult.err),
                                     k500InternalServerError);
            }

            // 이 경로(디렉터리면 그 아래 전부)의 커밋되지 않은 변경만 추린다.
            Json::Value relevant(Json::arrayValue);
            for (const auto &entry : entries) {
                if (pathCovers(path, entry["path"].asString())) {
                    relevant.append(entry);
                }
            }
            if (!relevant.empty()) {
                return errorResponse("P0810",
                                     "이 경로에 커밋되지 않은 변경 " + std::to_string(relevant.size()) +
                                         "개가 있습니다. 삭제하면 함께 사라집니다. 확인해 주세요.",
                                     k409Conflict, relevant);
            }
        }

        // 추적되는 경로는 인덱스에서도 지워야 한다(git rm). untracked 는 파일만 지운다.
        std::error_code ec;
        if (isTrackedPath(workDir, path)) {
            auto removed = GitRunner::rmPath(workDir, path);
            if (!removed.ok()) {
                // 인덱스에는 있는데 작업 트리에 없거나 git 이 거부하는 상태다 — 인덱스에서 빼고 파일을 지운다.
                LOG_WARN << "git rm 실패 — 인덱스 해제 후 파일 삭제로 대체 (" << path << "): " << trim(removed.err);
                GitRunner::run(workDir, {"rm", "-r", "--cached", "-q", "-f", "--", path});
                std::filesystem::remove_all(worktreeAbsPath(workDir, path), ec);
            }
        } else {
            std::filesystem::remove_all(worktreeAbsPath(workDir, path), ec);
        }
        if (ec) {
            return errorResponse("P0807", "삭제하지 못했습니다: " + ec.message(), k500InternalServerError);
        }

        // 열려 있던 doc 을 버린다 — 남기면 다음 flush 가 지운 파일을 되살린다.
        dropCollabDocs(repoId, branch, {path});

        broadcastTreeChanged(repoId, branch, "file_deleted", path);
        broadcastStatusChanged(repoId, branch);
        return respondWithStatus(workDir, "삭제했습니다.");
    });
}

// POST /api/github/repos/fetch — 수동 fetch --all --prune.
// 자동 fetch 만 두면 push 가 non-fast-forward 로 막히므로 수동 트리거를 반드시 둔다.
void GithubController::fetchRepository(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    Json::Value body;
    if (auto jsonPtr = req->getJsonObject()) {
        body = *jsonPtr;
    }

    int repoId = 0;
    if (body["repo_id"].isInt()) {
        repoId = body["repo_id"].asInt();
    } else if (!parseInt(req->getParameter("repo_id"), repoId)) {
        callback(errorResponse("400", "필수 파라미터(repo_id)가 누락되었거나 올바르지 않습니다.", k400BadRequest));
        return;
    }

    const std::string branch = body["branch"].isString() ? trim(body["branch"].asString()) : trim(req->getParameter("branch"));
    const std::string requester = requesterEmail(req);

    runNetworkOffLoop(req, std::move(callback), [requester, repoId, branch]() -> HttpResponsePtr {
        auto db = app().getDbClient();

        Json::Value repoRow;
        if (!singleRow(db->execSqlSync("SELECT * FROM get_github_repository_by_id($1, $2)", requester, repoId), repoRow)) {
            return errorResponse("P0801", "연결된 저장소를 찾을 수 없습니다.", k404NotFound);
        }
        const std::string localPath = repoRow["local_path"].asString();

        // fetch 는 공유 로컬 저장소의 ref 를 갱신하는 쓰기 작업이라 편집 권한을 요구한다.
        HttpResponsePtr denied;
        if (!requireGithubChange(requester, repoRow["node_id"].asInt(), denied)) {
            return denied;
        }

        GitRunner::Auth auth;
        const GitRunner::Auth *authPtr = nullptr;
        const std::string token = userToken(db, requester);
        if (!token.empty()) {
            auth.login = "x-access-token";
            auth.token = token;
            authPtr = &auth;
        }

        auto fetched = GitRunner::fetchAll(localPath, authPtr);
        if (!fetched.ok()) {
            const std::string detail = trim(fetched.err);
            LOG_WARN << "fetch 실패 (" << localPath << "): " << detail;
            // 인증 문제는 사용자가 조치할 수 있도록 따로 알려 준다.
            if (detail.find("Authentication failed") != std::string::npos ||
                detail.find("could not read Username") != std::string::npos ||
                detail.find("403") != std::string::npos) {
                return errorResponse("P0802", "GitHub 자격증명이 유효하지 않거나 이 저장소에 접근할 수 없습니다.",
                                     k401Unauthorized);
            }
            return errorResponse("P0807", "원격 저장소를 가져오지 못했습니다: " + detail, k502BadGateway);
        }

        // fetch 는 원격 추적 ref 만 바꾸지만 ahead/behind 뱃지도 상태다 — 다른 사용자에게도 알린다.
        // (요청에 브랜치가 없으면 어느 방으로 보낼지 알 수 없어 건너뛴다.)
        broadcastStatusChanged(repoId, branch);

        // 갱신된 브랜치 목록을 함께 돌려준다(확장이 브랜치 목록을 새로 고칠 수 있게).
        Json::Value data;
        data["branches"] = rowsToArray(db->execSqlSync("SELECT * FROM get_github_branches($1, $2)", requester, repoId));
        if (!branch.empty()) {
            data["branch"] = branch;
        }
        return successResponse(data, "원격 저장소를 최신으로 맞췄습니다.");
    });
}

// POST /api/github/repos/pull — fetch 후 현재 브랜치에 원격 변경을 병합한다.
//
// push 와 달리 작업 트리를 바꾸므로, 커밋되지 않은 변경이 있으면 거부한다. 병합 충돌도 worktree 에
// 남기지 않는다 — `merge --abort` 로 되돌린 뒤 충돌 경로만 돌려준다. 자동 rebase 는 쓰지 않는다:
// 로컬 커밋 SHA 가 바뀌면 DB 의 커밋 기록·업무 연결이 끊어진다.
void GithubController::pullRepository(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    auto jsonPtr = req->getJsonObject();
    if (!jsonPtr || !validateInts(jsonPtr, "repo_id") || !validateStrings(jsonPtr, "branch")) {
        callback(errorResponse("400", "필수 파라미터(repo_id, branch)가 누락되었습니다.", k400BadRequest));
        return;
    }

    const int repoId = (*jsonPtr)["repo_id"].asInt();
    const std::string branch = trim((*jsonPtr)["branch"].asString());
    if (branch.empty()) {
        callback(errorResponse("400", "필수 파라미터(branch)가 누락되었습니다.", k400BadRequest));
        return;
    }

    const std::string requester = requesterEmail(req);
    runNetworkOffLoop(req, std::move(callback), [requester, repoId, branch]() -> HttpResponsePtr {
        auto db = app().getDbClient();

        Json::Value repoRow;
        if (!singleRow(db->execSqlSync("SELECT * FROM get_github_repository_by_id($1, $2)", requester, repoId), repoRow)) {
            return errorResponse("P0801", "연결된 저장소를 찾을 수 없습니다.", k404NotFound);
        }

        std::string workDir;
        HttpResponsePtr failure;
        if (!resolveWorkDir(requester, repoRow, branch, workDir, failure, true)) {
            return failure;
        }

        // 병합 커밋의 작성자는 요청자 계정으로 확정한다(요청 본문을 신뢰하지 않는다).
        Json::Value userRow;
        if (!singleRow(db->execSqlSync("SELECT * FROM get_user_profile($1, $2)", requester, requester), userRow)) {
            return errorResponse("P0001", "로그인 사용자를 찾을 수 없습니다.", k404NotFound);
        }
        std::string authorName = userRow["name"].asString();
        const std::string authorEmail = userRow["email"].asString();
        if (!GitRunner::isValidIdentity(authorName)) {
            authorName = "Axis Share";
        }

        GitRunner::Auth auth;
        const GitRunner::Auth *authPtr = nullptr;
        const std::string token = userToken(db, requester);
        if (!token.empty()) {
            auth.login = "x-access-token";
            auth.token = token;
            authPtr = &auth;
        }

        std::lock_guard<std::mutex> syncGuard(*repoLock(repoId));

        // 열려 있는 문서의 마지막 편집을 파일로 내려놓은 뒤에만 병합한다. 실패하면 파일과 Y.Doc 이
        // 어긋난 채 병합할 수 있으므로 커밋과 같은 엄격한 기준을 쓴다.
        if (!flushCollabDocsStrict(repoId, branch)) {
            return errorResponse("P0908",
                                 "협업 서버와 연결하지 못해 원격 변경을 병합하지 않았습니다. 잠시 뒤 다시 시도해 주세요.",
                                 k503ServiceUnavailable);
        }

        GitResult statusResult;
        const Json::Value entries = readWorktreeStatus(workDir, statusResult);
        if (!statusResult.ok()) {
            return errorResponse("P0807", "작업 트리 상태를 읽지 못했습니다: " + trim(statusResult.err),
                                 k500InternalServerError);
        }
        if (!entries.empty()) {
            return errorResponse("P0810",
                                 "커밋되지 않은 변경이 있어 원격 변경을 병합하지 않았습니다. 먼저 커밋하거나 되돌려 주세요.",
                                 k409Conflict, entries);
        }

        auto fetched = GitRunner::fetchAll(workDir, authPtr);
        if (!fetched.ok()) {
            const std::string detail = trim(fetched.err);
            LOG_WARN << "pull 전 fetch 실패 (" << branch << "): " << detail;
            if (detail.find("Authentication failed") != std::string::npos ||
                detail.find("could not read Username") != std::string::npos ||
                detail.find("403") != std::string::npos ||
                detail.find("401") != std::string::npos) {
                return errorResponse("P0802", "GitHub 자격증명이 유효하지 않거나 이 저장소에 접근할 수 없습니다.",
                                     k401Unauthorized);
            }
            return errorResponse("P0807", "원격 저장소를 가져오지 못했습니다: " + detail, k502BadGateway);
        }

        const SyncState before = readSyncState(workDir, branch);
        if (!before.hasUpstream) {
            return errorResponse("P0801", "원격 추적 브랜치가 없습니다. 먼저 브랜치를 push 해 주세요.", k409Conflict);
        }
        if (before.behind == 0) {
            Json::Value data = syncToJson(before);
            data["action"] = "up_to_date";
            return successResponse(singleItemArray(data), "이미 원격 최신 상태입니다.");
        }
        if (before.headSha.empty()) {
            return errorResponse("P0807", "현재 커밋 SHA 를 읽지 못했습니다.", k500InternalServerError);
        }

        const std::string oldHead = before.headSha;
        const std::string action = before.ahead > 0 ? "merged" : "fast_forward";
        auto merged = GitRunner::merge(workDir, "origin/" + branch, authorName, authorEmail);
        if (!merged.ok()) {
            const Json::Value conflicts = unmergedPaths(workDir);
            auto mergeHead = GitRunner::run(workDir, {"rev-parse", "-q", "--verify", "MERGE_HEAD"});
            if (mergeHead.ok()) {
                auto aborted = GitRunner::run(workDir, {"merge", "--abort"});
                if (!aborted.ok()) {
                    LOG_WARN << "병합 충돌 후 merge --abort 실패 (" << branch << "): " << trim(aborted.err);
                }
            }

            const std::string detail = trim(merged.err);
            LOG_WARN << "pull 병합 실패 (" << branch << "): " << detail;
            if (!conflicts.empty() || mergeHead.ok()) {
                return errorResponse("P0817",
                                     "원격 변경과 충돌해 병합을 취소했습니다. 충돌 파일을 정리한 뒤 다시 시도해 주세요.",
                                     k409Conflict, conflicts);
            }
            return errorResponse("P0807", "원격 변경을 병합하지 못했습니다: " + detail, k500InternalServerError);
        }

        const SyncState after = readSyncState(workDir, branch);
        if (after.headSha.empty()) {
            return errorResponse("P0807", "병합 후 커밋 SHA 를 읽지 못했습니다.", k500InternalServerError);
        }
        const int changedPaths = syncCollabAndBroadcastChanges(repoId, branch, workDir, oldHead, after.headSha);
        broadcastBranchSynced(repoId, branch, requester, action);

        Json::Value data = syncToJson(after);
        data["action"] = action;
        data["changed_paths"] = changedPaths;
        return successResponse(singleItemArray(data),
                               action == "fast_forward" ? "원격 변경을 fast-forward 했습니다."
                                                        : "원격 변경을 병합했습니다.");
    });
}

// POST /api/github/repos/reset — 커밋 이력을 되돌린다.
//
// target=last  : HEAD~1 로 되돌린다. mode=soft 면 변경 내용을 스테이징된 채 남기고, hard 면 모두 버린다.
// target=remote: origin/<branch> 로 맞춘다. 로컬 커밋과 커밋되지 않은 변경을 모두 버리므로 hard 만 허용한다.
void GithubController::resetRepository(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    auto jsonPtr = req->getJsonObject();
    if (!jsonPtr || !validateInts(jsonPtr, "repo_id") || !validateStrings(jsonPtr, "branch", "target", "mode")) {
        callback(errorResponse("400", "필수 파라미터(repo_id, branch, target, mode)가 누락되었습니다.", k400BadRequest));
        return;
    }

    const int repoId = (*jsonPtr)["repo_id"].asInt();
    const std::string branch = trim((*jsonPtr)["branch"].asString());
    const std::string target = trim((*jsonPtr)["target"].asString());
    const std::string mode = trim((*jsonPtr)["mode"].asString());
    if (branch.empty()) {
        callback(errorResponse("400", "필수 파라미터(branch)가 누락되었습니다.", k400BadRequest));
        return;
    }
    if (target != "last" && target != "remote") {
        callback(errorResponse("400", "target 은 last 또는 remote 여야 합니다.", k400BadRequest));
        return;
    }
    if (mode != "soft" && mode != "mixed" && mode != "hard") {
        callback(errorResponse("400", "mode 는 soft, mixed, hard 중 하나여야 합니다.", k400BadRequest));
        return;
    }
    if (target == "remote" && mode != "hard") {
        callback(errorResponse("400", "원격 기준 초기화는 mode=hard 만 지원합니다.", k400BadRequest));
        return;
    }

    const std::string requester = requesterEmail(req);
    runNetworkOffLoop(req, std::move(callback), [requester, repoId, branch, target, mode]() -> HttpResponsePtr {
        auto db = app().getDbClient();

        Json::Value repoRow;
        if (!singleRow(db->execSqlSync("SELECT * FROM get_github_repository_by_id($1, $2)", requester, repoId), repoRow)) {
            return errorResponse("P0801", "연결된 저장소를 찾을 수 없습니다.", k404NotFound);
        }

        std::string workDir;
        HttpResponsePtr failure;
        if (!resolveWorkDir(requester, repoRow, branch, workDir, failure, true)) {
            return failure;
        }

        GitRunner::Auth auth;
        const GitRunner::Auth *authPtr = nullptr;
        const std::string token = userToken(db, requester);
        if (!token.empty()) {
            auth.login = "x-access-token";
            auth.token = token;
            authPtr = &auth;
        }

        std::lock_guard<std::mutex> resetGuard(*repoLock(repoId));

        if (target == "remote") {
            auto fetched = GitRunner::fetchAll(workDir, authPtr);
            if (!fetched.ok()) {
                const std::string detail = trim(fetched.err);
                LOG_WARN << "reset 전 fetch 실패 (" << branch << "): " << detail;
                if (detail.find("Authentication failed") != std::string::npos ||
                    detail.find("could not read Username") != std::string::npos ||
                    detail.find("403") != std::string::npos ||
                    detail.find("401") != std::string::npos) {
                    return errorResponse("P0802", "GitHub 자격증명이 유효하지 않거나 이 저장소에 접근할 수 없습니다.",
                                         k401Unauthorized);
                }
                return errorResponse("P0807", "원격 저장소를 가져오지 못했습니다: " + detail, k502BadGateway);
            }
        }

        const std::string targetRef = target == "remote" ? ("origin/" + branch) : "HEAD~1";
        auto targetSha = GitRunner::resolveRef(workDir, targetRef);
        if (!targetSha.ok()) {
            return errorResponse("P0818",
                                 target == "remote"
                                     ? "되돌릴 원격 브랜치를 찾을 수 없습니다. 먼저 fetch 해 주세요."
                                     : "첫 커밋은 되돌릴 수 없습니다.",
                                 k409Conflict);
        }
        const std::string newHead = trim(targetSha.out);

        const SyncState before = readSyncState(workDir, branch);
        const std::string oldHead = before.headSha;
        if (oldHead.empty()) {
            return errorResponse("P0807", "현재 커밋 SHA 를 읽지 못했습니다.", k500InternalServerError);
        }
        if (oldHead == newHead) {
            Json::Value data = syncToJson(before);
            data["action"] = "up_to_date";
            data["target"] = target;
            return successResponse(singleItemArray(data), "이미 되돌릴 커밋이 없습니다.");
        }

        if (mode == "hard") {
            // hard reset 은 작업 트리를 덮어쓴다. 먼저 열린 문서를 내려쓰고, 이후 새 내용으로 맞춘다.
            if (!flushCollabDocsStrict(repoId, branch)) {
                return errorResponse("P0908",
                                     "협업 서버와 연결하지 못해 되돌리지 않았습니다. 잠시 뒤 다시 시도해 주세요.",
                                     k503ServiceUnavailable);
            }

            // reset 이 버릴 미커밋 경로를 먼저 모은다. 커밋 diff 에 없더라도 열린 Y.Doc 을
            // 현재 파일 내용으로 맞춰야 다음 flush 가 버린 변경을 되살리지 않는다.
            GitResult statusResult;
            const Json::Value entries = readWorktreeStatus(workDir, statusResult);
            if (!statusResult.ok()) {
                return errorResponse("P0807", "작업 트리 상태를 읽지 못했습니다: " + trim(statusResult.err),
                                     k500InternalServerError);
            }
            std::vector<std::string> dirtyPaths;
            for (const auto &entry : entries) {
                if (entry["state"].asString() == "untracked") {
                    continue;   // reset --hard 는 untracked 를 지우지 않는다.
                }
                const std::string path = entry["path"].asString();
                if (!path.empty()) {
                    dirtyPaths.push_back(path);
                }
                if (entry["from"].isString() && !entry["from"].asString().empty()) {
                    dirtyPaths.push_back(entry["from"].asString());
                }
            }

            auto resetResult = GitRunner::reset(workDir, mode, newHead);
            if (!resetResult.ok()) {
                LOG_WARN << "reset 실패 (" << branch << ", " << target << ", " << mode << "): "
                         << trim(resetResult.err);
                return errorResponse("P0807", "커밋을 되돌리지 못했습니다: " + trim(resetResult.err),
                                     k500InternalServerError);
            }
            syncCollabAndBroadcastChanges(repoId, branch, workDir, oldHead, newHead, dirtyPaths);
        } else {
            auto resetResult = GitRunner::reset(workDir, mode, newHead);
            if (!resetResult.ok()) {
                LOG_WARN << "reset 실패 (" << branch << ", " << target << ", " << mode << "): "
                         << trim(resetResult.err);
                return errorResponse("P0807", "커밋을 되돌리지 못했습니다: " + trim(resetResult.err),
                                     k500InternalServerError);
            }
            broadcastStatusChanged(repoId, branch);
        }

        // 되돌린 커밋 중 아직 push 되지 않은 기록만 지운다. push 된 기록은 원격 이력이므로 남긴다.
        int removedCommits = 0;
        int removedLogs = 0;
        auto removed = GitRunner::run(workDir, {"rev-list", oldHead, "^" + newHead});
        if (removed.ok()) {
            std::istringstream lines(removed.out);
            std::string sha;
            while (std::getline(lines, sha)) {
                sha = trim(sha);
                if (sha.empty()) {
                    continue;
                }
                removedCommits += 1;
                try {
                    Json::Value logRow;
                    if (singleRow(db->execSqlSync("SELECT * FROM delete_github_unpushed_commit_log($1, $2, $3, $4)",
                                                  requester, repoId, branch, sha),
                                  logRow)) {
                        removedLogs += logRow["deleted_count"].asInt();
                    }
                } catch (const orm::DrogonDbException &e) {
                    // reset 자체는 이미 끝났다. 기록 정리 실패로 사용자의 되돌리기를 되돌리지 않는다.
                    LOG_WARN << "되돌린 커밋 기록 정리 실패 (" << sha << "): " << e.base().what();
                }
            }
        } else {
            LOG_WARN << "되돌린 커밋 목록 조회 실패 (" << branch << "): " << trim(removed.err);
        }

        const SyncState after = readSyncState(workDir, branch);
        broadcastBranchSynced(repoId, branch, requester, "reset");
        Json::Value data = syncToJson(after);
        data["action"] = "reset";
        data["target"] = target;
        data["mode"] = mode;
        data["old_head_sha"] = oldHead;
        data["new_head_sha"] = newHead;
        data["removed_commits"] = removedCommits;
        data["removed_commit_logs"] = removedLogs;
        return successResponse(singleItemArray(data), "브랜치를 되돌렸습니다.");
    });
}

// 커밋 (POST /api/github/repos/commits)

// POST /api/github/repos/commits — 커밋(+push)
void GithubController::commitPaths(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    auto jsonPtr = req->getJsonObject();
    if (!jsonPtr || !validateInts(jsonPtr, "repo_id") || !validateStrings(jsonPtr, "branch", "message")) {
        callback(errorResponse("400", "필수 파라미터(repo_id, branch, message)가 누락되었습니다.", k400BadRequest));
        return;
    }

    const int repoId = (*jsonPtr)["repo_id"].asInt();
    const std::string branch = trim((*jsonPtr)["branch"].asString());
    if (branch.empty()) {
        callback(errorResponse("400", "필수 파라미터(branch)가 누락되었습니다.", k400BadRequest));
        return;
    }

    const std::string message = trim((*jsonPtr)["message"].asString());
    if (message.empty()) {
        callback(errorResponse("400", "커밋 메시지가 비어 있습니다.", k400BadRequest));
        return;
    }

    // paths 를 생략하면 커밋되지 않은 변경 전체를 커밋한다.
    const std::vector<std::string> paths = jsonStringArray((*jsonPtr)["paths"]);

    // identity 는 '검증만' 한다. 실제 작성자는 서버가 확정한다.
    std::string identityName;
    std::string identityEmail;
    const Json::Value &identity = (*jsonPtr)["identity"];
    if (identity.isObject()) {
        if (identity["name"].isString()) {
            identityName = trim(identity["name"].asString());
        }
        if (identity["email"].isString()) {
            identityEmail = trim(identity["email"].asString());
        }
    }

    const std::string requester = requesterEmail(req);
    runOffLoop(req, std::move(callback),
               [requester, repoId, branch, message, paths, identityName, identityEmail]() -> HttpResponsePtr {
        auto db = app().getDbClient();

        // 1) 로그인 계정에서 작성자를 확정한다(요청 바디를 신뢰하지 않는다).
        Json::Value userRow;
        if (!singleRow(db->execSqlSync("SELECT * FROM get_user_profile($1, $2)", requester, requester), userRow)) {
            return errorResponse("P0001", "로그인 사용자를 찾을 수 없습니다.", k404NotFound);
        }
        const std::string accountName = userRow["name"].asString();
        const std::string accountEmail = userRow["email"].asString();

        // 커밋 이메일은 항상 계정 이메일이다. 다른 이메일을 지정하면 거부한다.
        if (!identityEmail.empty() && lowerCopy(identityEmail) != lowerCopy(accountEmail)) {
            return errorResponse("403", "커밋 이메일이 로그인 계정과 다릅니다: " + identityEmail, k403Forbidden);
        }
        // 이름은 확장의 user.name 을 쓰되 비어 있으면 계정 이름으로 대체한다.
        const std::string authorName = identityName.empty() ? accountName : identityName;
        const std::string authorEmail = accountEmail;

        Json::Value repoRow;
        if (!singleRow(db->execSqlSync("SELECT * FROM get_github_repository_by_id($1, $2)", requester, repoId), repoRow)) {
            return errorResponse("P0801", "연결된 저장소를 찾을 수 없습니다.", k404NotFound);
        }

        // 2) 브랜치의 작업 디렉터리를 확정한다(없으면 worktree 를 만든다).
        std::string workDir;
        HttpResponsePtr failure;
        if (!resolveWorkDir(requester, repoId, branch, workDir, failure, true)) {
            return failure;
        }

        // 3) 같은 저장소의 커밋은 직렬화한다(git index.lock 경합 방지).
        std::lock_guard<std::mutex> commitGuard(*repoLock(repoId));

        // 4) 커밋 전 강제 flush. 'git add' 는 collab 이 열린 doc 을 파일로 내려쓴
        //    뒤에 해야 한다 — 편집은 디바운스(기본 2초) 뒤에 파일이 되므로, 안 기다리면 방금 친
        //    내용이 커밋에서 빠진다. 다른 flush(스테이징·되돌리기·파일 삭제)와 달리 커밋은 결과를
        //    따진다: collab 이 응답하지 않거나 일부 파일을 못 내려썼으면 커밋을 거부한다(P0908).
        //    조용히 빠진 커밋을 만드는 것보다 사용자에게 다시 시도하게 하는 편이 낫기 때문이다.
        if (!flushCollabDocsStrict(repoId, branch)) {
            return errorResponse("P0908",
                                 "협업 서버와 연결하지 못해 커밋하지 않았습니다. 잠시 뒤 다시 시도해 주세요.",
                                 k503ServiceUnavailable);
        }

        // 5) 커밋 시작을 같은 브랜치 접속자에게 알린다. 확장은 이때 입력을 잠근다.
        //    flush 가 성공한 뒤에 알린다 — 거부로 끝날 때 다른 사용자의 입력 잠금이 남지 않게 하기
        //    위함이다(잠금은 commit_finished 로만 풀린다).
        Json::Value started;
        started["type"] = "commit_started";
        started["repo_id"] = repoId;
        started["branch"] = branch;
        started["email"] = requester;
        GithubWebSocketController::broadcastToBranch(repoId, branch, started);

        // 알림을 보낸 뒤부터는 어떤 실패로 끝나도 commit_finished 가 나가야 한다 — 아니면 이
        // 브랜치 접속자 전원의 커밋 입력이 잠긴 채로 남는다(성공 경로는 아래에서 직접 보낸다).
        CommitLockGuard lockGuard(repoId, branch, requester);

        // 6) 커밋 대상 스테이징 → 커밋.
        auto staged = paths.empty() ? GitRunner::run(workDir, {"add", "-A"})
                                    : GitRunner::stageAdd(workDir, paths);
        if (!staged.ok()) {
            return errorResponse("P0807", "변경 사항을 스테이징하지 못했습니다: " + trim(staged.err),
                                 k500InternalServerError);
        }

        auto committed = GitRunner::commit(workDir, message, authorName, authorEmail);
        if (!committed.ok()) {
            const std::string detail = trim(committed.err);
            // 커밋할 변경이 없는 경우는 오류가 아니라 사용자에게 그대로 알린다.
            if (detail.find("nothing to commit") != std::string::npos ||
                detail.find("no changes added to commit") != std::string::npos) {
                return errorResponse("P0807", "커밋할 변경 사항이 없습니다.", k409Conflict);
            }
            return errorResponse("P0807", "커밋하지 못했습니다: " + detail, k500InternalServerError);
        }

        auto shaResult = GitRunner::headSha(workDir);
        if (!shaResult.ok()) {
            return errorResponse("P0807", "커밋 SHA 를 읽지 못했습니다: " + trim(shaResult.err),
                                 k500InternalServerError);
        }
        const std::string sha = trim(shaResult.out);

        // 7) 커밋은 로컬에만 남긴다. 원격 전송은 별도 push(POST /api/github/repos/push)가 맡는다.
        //    그래서 커밋 로그는 pushed=false 로 남고, push 가 성공하면 mark_github_branch_pushed 가 뒤집는다.
        const bool pushed = false;

        // 8) 커밋 로그를 남기고 메시지의 WI-xxx 를 업무로 해석한다.
        Json::Value commitRow;
        if (!singleRow(db->execSqlSync("SELECT * FROM create_github_commit_log($1, $2, $3, $4, $5, $6, $7)",
                                       requester, repoId, branch, sha, authorEmail, message, pushed),
                       commitRow)) {
            return errorResponse("P0807", "커밋 기록을 저장하지 못했습니다.", k500InternalServerError);
        }

        // 9) 매칭된 업무가 아직 'todo' 면 첫 커밋으로 보고 'in_progress' 로 전환한다.
        //    전환은 강제가 아니며, 실패해도 커밋 자체는 성공으로 둔다.
        Json::Value transition(Json::objectValue);
        transition["applied"] = false;
        const std::string matchedId = idAsString(commitRow["matched_work_item_id"]);
        if (!matchedId.empty() && commitRow["matched_work_item_status"].asString() == "todo") {
            try {
                db->execSqlSync(
                    "SELECT * FROM update_work_item($1, $2, NULL, NULL, NULL, NULL, 'in_progress',"
                    " -1, -1, -1, NULL, NULL, NULL, FALSE, NULL, FALSE)",
                    requester, matchedId);
                transition["applied"] = true;
                transition["work_item_id"] = matchedId;
                transition["from"] = "todo";
                transition["to"] = "in_progress";
            } catch (const orm::DrogonDbException &e) {
                transition["reason"] = std::string(e.base().what());
            }
        }

        // 10) 응답 조립. 커밋은 로컬에만 남으므로 pushed=false 이고, 남은 push 대기 수(ahead)를 함께 알린다.
        //    원격 전송은 별도 push 커맨드가 맡는다 — 여기서는 push 하지 않는다.
        const SyncState sync = readSyncState(workDir, branch);
        commitRow["pushed"] = false;
        commitRow["ahead"] = sync.ahead;
        commitRow["behind"] = sync.behind;
        commitRow["has_upstream"] = sync.hasUpstream;
        commitRow["status_transition"] = transition;

        Json::Value data(Json::arrayValue);
        data.append(commitRow);

        // 커밋 결과를 같은 브랜치 접속자에게 알린다. 확장은 이때 입력 잠금을 풀고 트리를 새로 고친다.
        Json::Value finished;
        finished["type"] = "commit_finished";
        finished["repo_id"] = repoId;
        finished["branch"] = branch;
        finished["sha"] = sha;
        finished["email"] = requester;
        finished["pushed"] = false;
        finished["ahead"] = sync.ahead;
        GithubWebSocketController::broadcastToBranch(repoId, branch, finished);
        lockGuard.disarm(); // 결과를 담아 직접 보냈으니 가드는 아무것도 하지 않게 한다.

        notifyGithubEvent(db, repoRow["node_id"].asInt(), repoId,
                          repoRow["owner_login"].asString() + "/" + repoRow["repo_name"].asString(),
                          requester, "GITHUB_COMMIT", sha, "inserted", branch, sha, message);

        return successResponse(data, "커밋했습니다. 원격 전송은 push 로 따로 합니다.", k201Created);
    });
}

// GET /api/github/repos/sync?repo_id=3&branch=main — 현재 브랜치가 원격보다 얼마나 앞섰는지.
// 커밋·push 버튼의 상태와 graph 뷰의 "원격 위치" 표시가 이 값을 쓴다.
void GithubController::getSync(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    int repoId = 0;
    if (!parseInt(req->getParameter("repo_id"), repoId)) {
        callback(errorResponse("400", "필수 파라미터(repo_id)가 누락되었거나 올바르지 않습니다.", k400BadRequest));
        return;
    }

    const std::string branch = trim(req->getParameter("branch"));
    if (branch.empty()) {
        callback(errorResponse("400", "필수 파라미터(branch)가 누락되었습니다.", k400BadRequest));
        return;
    }

    const std::string requester = requesterEmail(req);
    runOffLoop(req, std::move(callback), [requester, repoId, branch]() -> HttpResponsePtr {
        std::string workDir;
        HttpResponsePtr failure;
        if (!resolveWorkDir(requester, repoId, branch, workDir, failure)) {
            return failure;
        }

        const SyncState state = readSyncState(workDir, branch);
        return successResponse(singleItemArray(syncToJson(state)), "원격 대비 상태를 조회했습니다.");
    });
}

// POST /api/github/repos/push — 커밋한 내용을 원격으로 올린다.
// 커밋(로컬 저장)과 분리된 별도 동작이다 — 로컬에만 쌓아 두고 싶은 경우를 위해 push 를 따로 둔다.
// push 는 요청한 사용자의 자격증명으로만 하며, 성공하면 그 브랜치의 미push 커밋 로그를 확정한다.
void GithubController::pushRepository(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    auto jsonPtr = req->getJsonObject();
    if (!jsonPtr || !validateInts(jsonPtr, "repo_id") || !validateStrings(jsonPtr, "branch")) {
        callback(errorResponse("400", "필수 파라미터(repo_id, branch)가 누락되었습니다.", k400BadRequest));
        return;
    }

    const int repoId = (*jsonPtr)["repo_id"].asInt();
    const std::string branch = trim((*jsonPtr)["branch"].asString());
    if (branch.empty()) {
        callback(errorResponse("400", "필수 파라미터(branch)가 누락되었습니다.", k400BadRequest));
        return;
    }

    const std::string requester = requesterEmail(req);
    runNetworkOffLoop(req, std::move(callback), [requester, repoId, branch]() -> HttpResponsePtr {
        auto db = app().getDbClient();

        Json::Value repoRow;
        if (!singleRow(db->execSqlSync("SELECT * FROM get_github_repository_by_id($1, $2)", requester, repoId), repoRow)) {
            return errorResponse("P0801", "연결된 저장소를 찾을 수 없습니다.", k404NotFound);
        }

        std::string workDir;
        HttpResponsePtr failure;
        if (!resolveWorkDir(requester, repoId, branch, workDir, failure, true)) {
            return failure;
        }

        const SyncState before = readSyncState(workDir, branch);
        if (before.ahead == 0) {
            Json::Value data = syncToJson(before);
            data["pushed"] = false;
            data["reason"] = "nothing_to_push";
            data["reason_label"] = "원격에 올릴 커밋이 없습니다";
            return successResponse(singleItemArray(data), "원격에 올릴 커밋이 없습니다.");
        }

        // 자격증명이 없으면 커밋은 그대로 두고 사유만 알린다.
        GitRunner::Auth auth;
        const GitRunner::Auth *authPtr = nullptr;
        const std::string token = userToken(db, requester);
        if (!token.empty()) {
            auth.login = "x-access-token";
            auth.token = token;
            authPtr = &auth;
        }

        if (authPtr == nullptr) {
            Json::Value data = syncToJson(before);
            data["pushed"] = false;
            data["reason"] = "credential_missing";
            data["reason_label"] = pushReasonLabel("credential_missing");
            data["code"] = "P0802";
            return successResponse(singleItemArray(data), "GitHub 자격증명이 없어 push 하지 못했습니다.");
        }

        // 같은 저장소의 커밋·push 는 직렬화한다(index.lock 경합 방지).
        std::lock_guard<std::mutex> pushGuard(*repoLock(repoId));

        auto pushedResult = GitRunner::push(workDir, branch, authPtr);
        if (!pushedResult.ok()) {
            const std::string reason = classifyPushFailure(pushedResult.err);
            LOG_WARN << "push 실패 (" << branch << "): " << trim(pushedResult.err);

            Json::Value data = syncToJson(before);
            data["pushed"] = false;
            data["reason"] = reason;
            data["reason_label"] = pushReasonLabel(reason);
            if (reason == "credential_invalid") {
                data["code"] = "P0802";
            }
            return successResponse(singleItemArray(data), "원격 push 에 실패했습니다: " + pushReasonLabel(reason));
        }

        // 성공: 그 브랜치의 미push 커밋 로그를 확정한다(pushed_by_email = 요청자).
        Json::Value data = syncToJson(readSyncState(workDir, branch));
        data["pushed"] = true;
        int pushedCommitCount = before.ahead;
        try {
            Json::Value markRow;
            if (singleRow(db->execSqlSync("SELECT * FROM mark_github_branch_pushed($1, $2, $3)",
                                          requester, repoId, branch),
                          markRow)) {
                data["pushed_commit_count"] = markRow["pushed_commit_count"];
                pushedCommitCount = markRow["pushed_commit_count"].asInt();
            }
        } catch (const orm::DrogonDbException &e) {
            // push 는 이미 성공했다. 기록 실패로 사용자 작업을 되돌리지 않고 로그만 남긴다.
            LOG_WARN << "push 완료 기록 실패 (" << branch << "): " << e.base().what();
        }

        Json::Value finished;
        finished["type"] = "push_finished";
        finished["repo_id"] = repoId;
        finished["branch"] = branch;
        finished["email"] = requester;
        finished["pushed"] = true;
        finished["ahead"] = data["ahead"];
        GithubWebSocketController::broadcastToBranch(repoId, branch, finished);

        notifyGithubEvent(db, repoRow["node_id"].asInt(), repoId,
                          repoRow["owner_login"].asString() + "/" + repoRow["repo_name"].asString(),
                          requester, "GITHUB_PUSH", branch, "pushed", branch, "", "", pushedCommitCount);

        return successResponse(singleItemArray(data), "원격에 push 했습니다.");
    });
}

// 앱 → 확장 핸드오프 / 확장 세션

// POST /api/github/handoff — 앱이 VSCode 확장에 넘길 1회용 코드를 발급한다.
// 토큰을 vscode:// URI 에 싣지 않기 위한 우회로이고, 실제 토큰은 확장이 교환 단계에서 받는다.
void GithubController::createHandoffCode(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    auto jsonPtr = req->getJsonObject();
    if (!jsonPtr || !validateInts(jsonPtr, "node_id", "repo_id")) {
        callback(errorResponse("400", "필수 파라미터(node_id, repo_id)가 누락되었습니다.", k400BadRequest));
        return;
    }

    const std::string requester = requesterEmail(req);
    const int nodeId = (*jsonPtr)["node_id"].asInt();
    const int repoId = (*jsonPtr)["repo_id"].asInt();

    runOffLoop(req, std::move(callback), [requester, nodeId, repoId]() -> HttpResponsePtr {
        auto db = app().getDbClient();
        // 권한·저장소-노드 일치 검사는 SQL 함수가 수행한다(불일치면 P0801).
        auto result = db->execSqlSync("SELECT * FROM create_github_handoff_code($1, $2, $3)",
                                      requester, nodeId, repoId);
        return successResponse(rowsToArray(result), "확장에서 사용할 1회용 코드를 발급했습니다.", k201Created);
    });
}

// POST /api/github/sessions — 1회용 코드를 확장 전용 토큰으로 교환한다.
// 인증 없는 라우트다(JwtFilter 미적용) — 확장은 이 호출로 토큰을 처음 받기 때문이다.
void GithubController::exchangeSession(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    auto jsonPtr = req->getJsonObject();
    if (!jsonPtr || !validateStrings(jsonPtr, "code")) {
        callback(errorResponse("400", "필수 파라미터(code)가 누락되었습니다.", k400BadRequest));
        return;
    }

    const std::string code = (*jsonPtr)["code"].asString();

    runOffLoop(req, std::move(callback), [code]() -> HttpResponsePtr {
        auto db = app().getDbClient();

        // 1) 1회용 코드를 소비한다(원자적 — 동시 요청 중 하나만 성공한다).
        //    여기서 실패하면 토큰을 만들지 않는다.
        Json::Value handoff;
        if (!singleRow(db->execSqlSync("SELECT * FROM consume_github_handoff_code($1)", code), handoff)) {
            return errorResponse("P0811", "확장 연결 코드가 유효하지 않거나 만료되었습니다. 앱에서 다시 시도해 주세요.",
                                 k401Unauthorized);
        }
        const std::string email = handoff["user_email"].asString();

        // 2) 앱과 같은 JWT 규격으로 발급한다 — JwtFilter 와 제어 소켓이 그대로 검증한다.
        Json::Value tokens = AuthController::generateToken(email);

        // 3) 리프레시 토큰만 확장 전용 테이블에 남긴다.
        //    앱의 user_refresh_tokens 와 분리해야 서로의 세션을 무효화하지 않는다.
        db->execSqlSync("SELECT * FROM create_github_extension_token($1, $2, $3)",
                        email, tokens["refresh_token"].asString(), tokens["refresh_token_expiry"].asString());

        // 4) 응답 조립. 토큰은 이 응답에서만 나가고 로그·에러 메시지에는 넣지 않는다.
        //    user_name 은 확장이 커밋 이름 기본값으로 쓴다(커밋 이메일은 서버가 계정 이메일로 강제한다).
        Json::Value item;
        item["access_token"] = tokens["access_token"];
        item["refresh_token"] = tokens["refresh_token"];
        item["expires_in"] = accessTokenExpirySeconds();
        item["user_email"] = email;
        item["user_name"] = handoff["user_name"];
        item["node_id"] = handoff["node_id"];
        item["repo_id"] = handoff["repo_id"];

        Json::Value data(Json::arrayValue);
        data.append(item);
        return successResponse(data, "확장 세션을 발급했습니다.");
    });
}

// POST /api/github/sessions/refresh — 확장 토큰 자동 갱신.
// 앱의 /api/users/refresh 와 같은 방식이되, 확장 전용 테이블만 본다(앱 세션과 분리).
void GithubController::refreshSession(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    auto jsonPtr = req->getJsonObject();
    if (!jsonPtr || !validateStrings(jsonPtr, "refresh_token")) {
        callback(errorResponse("400", "필수 파라미터(refresh_token)가 누락되었습니다.", k400BadRequest));
        return;
    }

    const std::string refreshToken = (*jsonPtr)["refresh_token"].asString();

    runOffLoop(req, std::move(callback), [refreshToken]() -> HttpResponsePtr {
        auto db = app().getDbClient();

        // 1) 이 토큰의 주인을 먼저 찾는다. 만료된 토큰은 여기서 걸러진다.
        Json::Value owner;
        if (!singleRow(db->execSqlSync(
                           "SELECT * FROM get_github_extension_token_owner($1)",
                           refreshToken),
                       owner)) {
            return errorResponse("P0812", "확장 세션이 만료되었습니다. 앱에서 다시 연결해 주세요.", k401Unauthorized);
        }
        const std::string email = owner["user_email"].as<std::string>();

        // 2) 새 토큰 세트를 만든다(회전 후 값을 저장해야 하므로 먼저 발급한다).
        Json::Value tokens = AuthController::generateToken(email);

        // 3) 회전. 같은 토큰으로 동시에 두 번 오면 DB 가 하나만 통과시킨다(P0812).
        Json::Value rotated;
        if (!singleRow(db->execSqlSync("SELECT * FROM rotate_github_extension_token($1, $2, $3)",
                                       refreshToken, tokens["refresh_token"].asString(),
                                       tokens["refresh_token_expiry"].asString()),
                       rotated)) {
            return errorResponse("P0812", "확장 세션이 만료되었습니다. 앱에서 다시 연결해 주세요.", k401Unauthorized);
        }

        // 4) 응답 조립 (토큰은 이 응답에서만 나간다)
        Json::Value item;
        item["access_token"] = tokens["access_token"];
        item["refresh_token"] = tokens["refresh_token"];
        item["expires_in"] = accessTokenExpirySeconds();
        item["user_email"] = email;
        item["expires_at"] = rotated["expires_at"];

        Json::Value data(Json::arrayValue);
        data.append(item);
        return successResponse(data, "확장 세션을 갱신했습니다.");
    });
}
