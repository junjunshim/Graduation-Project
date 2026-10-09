#include "GithubController.h"
#include "ResponseUtils.h"
#include "ValidationUtils.h"
#include "GitRunner.h"
#include "GithubWebSocketController.h"
#include "AuthController.h"

#include <drogon/HttpClient.h>
#include <json/json.h>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdlib>
#include <filesystem>
#include <future>
#include <map>
#include <memory>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

using namespace api;
using namespace drogon;
using namespace app_utils;

namespace {

// 파일 크기 상한 (§6-10 / §12.6). 넘으면 읽기 전용으로만 다룬다.
constexpr long long kMaxTextFileBytes = 512 * 1024;

// ---------------------------------------------------------------------------
// 응답 헬퍼
// ---------------------------------------------------------------------------

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
HttpResponsePtr dbErrorResponse(const orm::DrogonDbException &e) {
    Json::Value ret = parseDbError(e);
    auto httpCode = static_cast<HttpStatusCode>(ret["http_code"].asInt());
    ret.removeMember("http_code");
    return makeJsonResponse(ret, httpCode);
}

// ---------------------------------------------------------------------------
// 값 변환 / 문자열 헬퍼
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 환경/설정
// ---------------------------------------------------------------------------

// 자격증명 암호화 키는 환경변수에서만 읽는다. 없으면 자격증명을 저장하지 않는다 (§5, fail-closed).
std::string credentialKey() {
    const char *value = std::getenv("GITHUB_TOKEN_KEY");
    return (value != nullptr) ? std::string(value) : std::string();
}

// 확장에 알려 줄 액세스 토큰 수명(초). AuthController::generateToken 이 쓰는 설정과 같은 값이다.
int accessTokenExpirySeconds() {
    return app().getCustomConfig()["access_token_expiry"].asInt();
}

// §3.2: clone 경로는 repository/<node_id>/<repo_name>.
// data/03_func_github.sql 의 create_github_repository 와 같은 식이어야 한다.
std::string localPathFor(int nodeId, const std::string &repoName) {
    return "repository/" + std::to_string(nodeId) + "/" + repoName;
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

// ---------------------------------------------------------------------------
// 실행 헬퍼
// ---------------------------------------------------------------------------

// clone/fetch 같은 git 실행과 동기 DB 호출은 오래 걸린다.
// 이벤트 루프를 막지 않도록 워커 스레드에서 실행하고, 응답만 원래 루프로 되돌린다.
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
            LOG_ERROR << "GitHub 핸들러 실패: " << e.what();
            resp = errorResponse("500", "서버 처리 중 오류가 발생했습니다.", k500InternalServerError);
        }
        app().getLoop()->queueInLoop([cb, resp]() { (*cb)(resp); });
    });
    worker.detach();
}

// ---------------------------------------------------------------------------
// 작업 트리 헬퍼 (§2.3: 브랜치 격리 = git worktree)
// ---------------------------------------------------------------------------

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

// 브랜치의 작업 디렉터리를 준비한다(이미 있으면 그대로 쓴다).
//  - 로컬에 브랜치가 있으면 그대로 붙인다
//  - 원격에만 있으면 origin/<branch> 에서 추적 브랜치를 만들어 붙인다
//  - 둘 다 없으면 기준 브랜치에서 새로 만든다
GitResult ensureWorktree(const std::string &localPath, const std::string &worktreePath,
                         const std::string &branch, const std::string &baseBranch,
                         const GitRunner::Auth *auth) {
    if (worktreeReady(worktreePath)) {
        GitResult ready;
        ready.exitCode = 0;
        return ready;
    }

    // 원격에만 있는 브랜치·기준 커밋을 쓰려면 먼저 원격을 최신화한다.
    auto fetched = GitRunner::fetchAll(localPath, auth);
    if (!fetched.ok()) {
        LOG_WARN << "worktree 준비 전 fetch 실패 (" << branch << "): " << trim(fetched.err);
    }

    if (GitRunner::run(localPath, {"show-ref", "--verify", "--quiet", "refs/heads/" + branch}).ok()) {
        return GitRunner::worktreeAdd(localPath, worktreePath, branch);
    }
    if (GitRunner::run(localPath, {"show-ref", "--verify", "--quiet", "refs/remotes/origin/" + branch}).ok()) {
        return GitRunner::worktreeAdd(localPath, worktreePath, branch, "origin/" + branch);
    }
    return GitRunner::worktreeAdd(localPath, worktreePath, branch, baseBranch.empty() ? "HEAD" : baseBranch);
}

// 요청한 브랜치가 실제로 checkout 되어 있는 작업 디렉터리를 확정한다.
// 기본 브랜치는 clone 디렉터리 자체가 작업 트리이고, 나머지는 등록된 worktree 를 쓴다.
// 실패하면 outError 에 응답을 담고 false 를 돌려준다.
bool resolveWorkDir(const std::string &requester, int repoId, const std::string &requestedBranch,
                    std::string &outWorkDir, HttpResponsePtr &outError) {
    auto db = app().getDbClient();

    Json::Value repoRow;
    if (!singleRow(db->execSqlSync("SELECT * FROM get_github_repository_by_id($1, $2)", requester, repoId), repoRow)) {
        outError = errorResponse("P0801", "연결된 저장소를 찾을 수 없습니다.", k404NotFound);
        return false;
    }

    const std::string localPath = repoRow["local_path"].asString();
    const std::string defaultBranch = repoRow["default_branch"].asString();
    const std::string branch = requestedBranch.empty() ? defaultBranch : requestedBranch;

    if (branch == defaultBranch) {
        outWorkDir = localPath;
        return true;
    }

    // 등록된 브랜치여야 worktree 경로를 알 수 있다.
    // (원격에만 있는 브랜치는 먼저 POST /api/github/repos/branches 로 등록한다)
    Json::Value target;
    bool found = false;
    Json::Value branches = rowsToArray(db->execSqlSync("SELECT * FROM get_github_branches($1, $2)", requester, repoId));
    for (const auto &item : branches) {
        if (item["name"].asString() == branch) {
            target = item;
            found = true;
            break;
        }
    }
    if (!found) {
        outError = errorResponse("P0801", "등록되지 않은 브랜치입니다: " + branch, k404NotFound);
        return false;
    }

    const std::string worktreePath = target["worktree_path"].asString();
    if (worktreePath.empty()) {
        outError = errorResponse("P0807", "브랜치 작업 디렉터리 정보가 없습니다: " + branch, k500InternalServerError);
        return false;
    }

    GitRunner::Auth auth;
    const GitRunner::Auth *authPtr = nullptr;
    const std::string token = userToken(db, requester);
    if (!token.empty()) {
        auth.login = "x-access-token";
        auth.token = token;
        authPtr = &auth;
    }

    auto ready = ensureWorktree(localPath, worktreePath, branch, target["base_branch"].asString(), authPtr);
    if (!ready.ok()) {
        LOG_WARN << "worktree 준비 실패 (" << branch << "): " << trim(ready.err);
        outError = errorResponse("P0807", "브랜치 작업 디렉터리를 준비하지 못했습니다: " + trim(ready.err),
                                 k500InternalServerError);
        return false;
    }

    outWorkDir = worktreePath;
    return true;
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

// CRLF 를 LF 로만 바꾼다(되돌리기 payload 용). collab 의 Yjs 텍스트는 LF 고정이고 flush 때 원본 EOL 을 복원한다(§9.4).
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
// 확장 SCM 뷰가 그대로 쓰는 [{path, state, staged}] 로 바꾼다 (§3.2).
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

// 작업 트리 상태를 읽는다. 실패하면 out.ok() 가 false 다.
Json::Value readWorktreeStatus(const std::string &workDir, GitResult &out) {
    out = GitRunner::run(workDir, {"status", "--porcelain=v1", "--untracked-files=all", "-z"});
    if (!out.ok()) {
        return Json::Value(Json::arrayValue);
    }
    return parseStatusPorcelain(out.out);
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
// 저장소 단위 뮤텍스를 돌려주어 커밋 구간을 직렬화한다 (§12.11).
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

// 현재 브랜치가 원격보다 얼마나 앞섰는지/뒤처졌는지 (§3.2 GET /api/github/repos/sync).
// 커밋과 push 가 분리되어 있어(§12.11) 둘이 같은 계산을 공유한다.
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
    int count = 0;
    if (auto ahead = GitRunner::revListCount(workDir, remoteRef + "..HEAD"); ahead.ok() && parseInt(trim(ahead.out), count)) {
        state.ahead = count;
    }
    if (auto behind = GitRunner::revListCount(workDir, "HEAD.." + remoteRef); behind.ok() && parseInt(trim(behind.out), count)) {
        state.behind = count;
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

// collab 내부 API 를 부르고 **응답을 기다리는** 상한(초). 같은 호스트 안이라 짧아도 충분하고,
// 이 시간을 넘기면 collab 이 죽었다고 보고 그냥 진행한다.
constexpr int kCollabCallWaitSeconds = 3;

// collab 의 내부 API 를 부르고 **끝날 때까지 기다린다** (§12.11, §12.11.1).
//
// 왜 기다리는가: 둘 다 "collab 이 파일을 내려쓴 뒤에 git 을 돌려야" 하기 때문이다.
//   - 되돌리기: git 은 체크아웃할 때 그 경로가 비어 있다고 본 뒤 O_CREAT|O_EXCL 로 새로 만든다(entry.c).
//     그 사이에 collab 이 같은 경로를 쓰면 `unable to create file <path>: File exists` 로 죽는다(실측).
//   - 커밋: 편집은 디바운스(기본 2초) 뒤에 파일로 내려가므로, 안 기다리면 마지막 편집이 빠진 채 커밋된다.
// collab 이 없거나 제때 응답하지 않으면 false 를 돌려주고 호출자는 그대로 진행한다 — collab 이 죽어
// 있어도 되돌리기·커밋 자체를 실패시키지 않는다(그때는 메모리에 doc 이 없어 내려쓸 것도 없다).
bool callCollabInternal(const std::string &path, const Json::Value &body) {
    const char *baseValue = std::getenv("COLLAB_BASE");
    const char *tokenValue = std::getenv("INTERNAL_TOKEN");
    const std::string collabBase = (baseValue != nullptr) ? std::string(baseValue) : std::string();
    const std::string token = (tokenValue != nullptr) ? std::string(tokenValue) : std::string();
    if (collabBase.empty() || token.empty()) {
        return false;
    }

    const int repoId = body["repo_id"].isInt() ? body["repo_id"].asInt() : 0;

    // HttpClient 는 생성한 루프에서 호출해야 한다. 우리는 작업 스레드에 있으므로 메인 루프로 올리고,
    // 이 스레드는 promise 로 응답을 기다린다 — 기다리지 않으면 collab 의 쓰기와 git 작업이 겹친다.
    auto done = std::make_shared<std::promise<bool>>();
    std::future<bool> future = done->get_future();
    app().getLoop()->queueInLoop([collabBase, token, path, body, repoId, done]() {
        auto client = HttpClient::newHttpClient(collabBase, app().getLoop());
        auto request = HttpRequest::newHttpJsonRequest(body);
        request->setMethod(Post);
        request->setPath(path);
        request->addHeader("X-Internal-Token", token);

        client->sendRequest(request, [client, path, repoId, done](ReqResult result, const HttpResponsePtr &response) {
            const bool ok = (result == ReqResult::Ok && response != nullptr &&
                             response->getStatusCode() == k200OK);
            if (!ok) {
                LOG_WARN << "collab 호출 실패. path=" << path << " repo=" << repoId
                         << " result=" << static_cast<int>(result)
                         << " status=" << ((response == nullptr) ? 0 : static_cast<int>(response->getStatusCode()));
            }
            done->set_value(ok);
        });
    });

    if (future.wait_for(std::chrono::seconds(kCollabCallWaitSeconds)) != std::future_status::ready) {
        LOG_WARN << "collab 호출 응답 없음(기다리지 않고 진행). path=" << path << " repo=" << repoId;
        return false;
    }
    return future.get();
}

// 되돌리기(§12.11.1): 열려 있는 doc 을 되돌린 내용으로 맞춘다.
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

// 커밋 전 강제 flush(§12.11): 아직 파일로 내려가지 않은 편집을 먼저 내려쓴다.
// 이걸 빼면 편집 후 디바운스(2초) 안에 커밋했을 때 그 편집이 커밋에서 빠진다.
bool flushCollabDocs(int repoId, const std::string &branch) {
    Json::Value body;
    body["repo_id"] = repoId;
    body["branch"] = branch;
    return callCollabInternal("/internal/collab/flush", body);
}

// 작업 트리·인덱스 상태가 바뀐 것을 같은 브랜치 접속자에게 알린다 (§15.10).
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

// push 실패 stderr 를 확장이 배지로 구분할 사유로 나눈다 (§12.11).
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
}  // namespace

// ===========================================================================
// 저장소 연결 / 목록 / 해제
// ===========================================================================

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

    runOffLoop(std::move(callback), [requester, nodeId, owner, repo, requestedBranch, givenUrl]() -> HttpResponsePtr {
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
    runOffLoop(std::move(callback), [requester, nodeId]() -> HttpResponsePtr {
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
    runOffLoop(std::move(callback), [requester, repoId]() -> HttpResponsePtr {
        auto db = app().getDbClient();
        // clone 디렉터리는 지우지 않는다. 연결만 끊고 다시 연결하면 그대로 재사용한다.
        auto result = db->execSqlSync("SELECT * FROM delete_github_repository($1, $2)", requester, repoId);
        return successResponse(rowsToArray(result), "저장소 연결을 해제했습니다.");
    });
}

// ===========================================================================
// 서버 로컬 저장소 조회
// ===========================================================================

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

    runOffLoop(std::move(callback), [requester, repoId, branch, path]() -> HttpResponsePtr {
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

        // 디렉터리 단위 lazy 조회 (§12.3): 요청한 경로의 한 단계만 받는다.
        auto tree = GitRunner::lsTree(localPath, ref, path, true);
        if (!tree.ok()) {
            LOG_WARN << "ls-tree 실패 (" << ref << ":" << path << "): " << trim(tree.err);
            return errorResponse("P0801", "브랜치 또는 경로를 찾을 수 없습니다: " + ref, k404NotFound);
        }

        Json::Value items(Json::arrayValue);
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
            Json::Value node;
            node["name"] = name;
            node["path"] = path.empty() ? name : (path + "/" + name);

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
        }

        return successResponse(items, "저장소 구조를 조회했습니다.");
    });
}

// GET /api/github/repos/file?repo_id=3&branch=main&path=src/a.ts — 파일 내용
void GithubController::getRepositoryFile(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    int repoId = 0;
    if (!parseInt(req->getParameter("repo_id"), repoId)) {
        callback(errorResponse("400", "필수 파라미터(repo_id)가 누락되었거나 올바르지 않습니다.", k400BadRequest));
        return;
    }

    const std::string branch = req->getParameter("branch");
    const std::string path = normalizePath(req->getParameter("path"));
    if (path.empty()) {
        callback(errorResponse("400", "필수 파라미터(path)가 누락되었습니다.", k400BadRequest));
        return;
    }

    // 클라이언트가 캐시한 시각(직전 응답의 modified_at). 같으면 내용을 다시 보내지 않는다.
    const std::string since = req->getParameter("since");

    const std::string requester = requesterEmail(req);
    runOffLoop(std::move(callback), [requester, repoId, branch, path, since]() -> HttpResponsePtr {
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

        const std::string spec = treeishOf(ref, path);

        // 이 파일이 마지막으로 바뀐 시각. 내용을 작업 트리가 아니라 커밋된 트리(git show)에서 읽으므로
        // 커밋 시각이 곧 그 파일의 버전이고, 캐시 검증 토큰으로 쓰기에 충분하다.
        auto logResult = GitRunner::run(localPath, {"log", "-1", "--format=%cI", ref, "--", path});
        const std::string modifiedAt = logResult.ok() ? trim(logResult.out) : "";

        // 캐시 검증: 클라이언트가 들고 있는 시각과 같으면 버전이 바뀌지 않았다는 뜻이므로 내용을 생략한다.
        if (!since.empty() && !modifiedAt.empty() && since == modifiedAt) {
            Json::Value unchanged;
            unchanged["repo_id"] = repoId;
            unchanged["branch"] = ref;
            unchanged["path"] = path;
            unchanged["changed"] = false;
            unchanged["modified_at"] = modifiedAt;
            return successResponse(singleItemArray(unchanged), "이미 받은 내용이 최신입니다.");
        }

        // 1) 존재·크기 확인
        auto sizeResult = GitRunner::run(localPath, {"cat-file", "-s", spec});
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
        data["branch"] = ref;
        data["path"] = path;
        data["size"] = static_cast<Json::Int64>(size);
        data["encoding"] = "utf-8";
        data["read_only"] = false;
        data["content"] = "";
        data["changed"] = true;
        data["modified_at"] = modifiedAt;

        // 2) 상한 초과는 읽기 전용 (§12.6)
        if (size > kMaxTextFileBytes) {
            data["read_only"] = true;
            data["reason"] = "too_large";
            return successResponse(singleItemArray(data), "파일이 너무 커서 읽기 전용으로 표시했습니다.");
        }

        auto content = GitRunner::run(localPath, {"show", spec});
        if (!content.ok()) {
            return errorResponse("P0801", "파일 내용을 읽지 못했습니다: " + path, k500InternalServerError);
        }

        // 3) 바이너리(NUL 포함)도 읽기 전용
        if (content.out.find('\0') != std::string::npos) {
            data["read_only"] = true;
            data["reason"] = "binary";
            data["encoding"] = "binary";
            return successResponse(singleItemArray(data), "바이너리 파일이라 읽기 전용으로 표시했습니다.");
        }

        data["content"] = content.out;
        data["eol"] = (content.out.find("\r\n") != std::string::npos) ? "crlf" : "lf";
        return successResponse(singleItemArray(data), "파일을 조회했습니다.");
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
    runOffLoop(std::move(callback), [requester, repoId]() -> HttpResponsePtr {
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
// 서버 로컬 clone 의 실제 git 이력이다. 읽기 전용이라 GitHub 자격증명이 필요 없다.
void GithubController::getRepositoryCommits(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    int repoId = 0;
    if (!parseInt(req->getParameter("repo_id"), repoId)) {
        callback(errorResponse("400", "필수 파라미터(repo_id)가 누락되었거나 올바르지 않습니다.", k400BadRequest));
        return;
    }

    const std::string branch = req->getParameter("branch");

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
    runOffLoop(std::move(callback), [requester, repoId, branch, limit]() -> HttpResponsePtr {
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

        auto logResult = GitRunner::logWithParents(localPath, ref, limit);
        if (!logResult.ok()) {
            LOG_WARN << "커밋 로그 조회 실패 (" << ref << "): " << trim(logResult.err);
            return errorResponse("P0807", "커밋 기록을 읽지 못했습니다: " + trim(logResult.err),
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

// ===========================================================================
// 사용자 GitHub 자격증명 (PAT)
// ===========================================================================

// GET /api/github/credentials — 내 자격증명 상태 (토큰은 절대 넣지 않는다)
void GithubController::getCredentialStatus(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    const std::string requester = requesterEmail(req);
    runOffLoop(std::move(callback), [requester]() -> HttpResponsePtr {
        auto db = app().getDbClient();
        auto result = db->execSqlSync("SELECT * FROM get_github_user_credential($1)", requester);
        return successResponse(rowsToArray(result), "GitHub 자격증명 상태를 조회했습니다.");
    });
}

// POST /api/github/credentials — PAT 등록 (§6-11). GitHub API 로 검증한 뒤 암호화해 저장한다.
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
    app().getLoop()->queueInLoop([respond, requester, token, key]() {
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
            [client, respond, requester, token, key](ReqResult result, const HttpResponsePtr &apiResp) {
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
                    [respond](const orm::DrogonDbException &e) { (*respond)(dbErrorResponse(e)); },
                    requester, login, token, key, std::string("pat"), scopes);
            });
    });
}

// DELETE /api/github/credentials — 자격증명 연결 해제(소프트 삭제 + 암호문 폐기)
void GithubController::disconnectCredential(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    const std::string requester = requesterEmail(req);
    runOffLoop(std::move(callback), [requester]() -> HttpResponsePtr {
        auto db = app().getDbClient();
        auto result = db->execSqlSync("SELECT * FROM delete_github_user_credential($1)", requester);
        return successResponse(rowsToArray(result), "GitHub 자격증명 연결을 해제했습니다.");
    });
}

// ===========================================================================
// 브랜치 접속자 / 수명주기 (§1.3-5, §1.3-10)
// ===========================================================================

// GET /api/github/repos/presence?repo_id=3 — 브랜치별 접속자
void GithubController::getPresence(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    int repoId = 0;
    if (!parseInt(req->getParameter("repo_id"), repoId)) {
        callback(errorResponse("400", "필수 파라미터(repo_id)가 누락되었거나 올바르지 않습니다.", k400BadRequest));
        return;
    }

    const std::string requester = requesterEmail(req);
    runOffLoop(std::move(callback), [requester, repoId]() -> HttpResponsePtr {
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

    runOffLoop(std::move(callback), [requester, repoId, name, baseBranch]() -> HttpResponsePtr {
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

        // 브랜치 생성은 같은 저장소의 모든 접속자에게 알린다(§1.3-5).
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
    runOffLoop(std::move(callback), [requester, repoId, name, force]() -> HttpResponsePtr {
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

        // 1) 접속자가 있으면 거부한다 (P0809). 작업 중인 사용자를 강제로 밀어내지 않는다.
        const Json::Value presence = target["presence"];
        if (presence.isArray() && !presence.empty()) {
            return errorResponse("P0809", "이 브랜치에서 작업 중인 사용자가 있습니다.", k409Conflict, presence);
        }

        const std::string worktreePath = target["worktree_path"].asString();

        // git 이 기억하는 실제 worktree 경로를 우선한다. DB 의 worktree_path 와 어긋난 worktree
        // (과거 상대 경로 버그로 저장소 안쪽에 만들어진 것)도 이 경로로 찾아낼 수 있다.
        std::string registeredWorktree;
        const bool hasRegisteredWorktree = findWorktreeForBranch(localPath, name, registeredWorktree);
        const std::string gitWorktreePath = hasRegisteredWorktree ? registeredWorktree : worktreePath;

        // 2) 커밋되지 않은 변경이 있으면 거부한다 (P0810). force 면 건너뛴다.
        if (!isDefault && !force && worktreeReady(gitWorktreePath)) {
            GitResult statusResult;
            const Json::Value entries = readWorktreeStatus(gitWorktreePath, statusResult);
            if (!statusResult.ok()) {
                return errorResponse("P0807", "브랜치 상태를 확인하지 못했습니다: " + trim(statusResult.err),
                                     k500InternalServerError);
            }
            if (!entries.empty()) {
                return errorResponse("P0810",
                                     "이 브랜치에 커밋되지 않은 변경(staged/modified/untracked)이 있습니다. 확인해 주세요.",
                                     k409Conflict, entries);
            }
        }

        // 3) 작업 디렉터리 → 로컬 브랜치 → DB 행 순서로 정리한다.
        //    worktree 를 여기서 지우지 못하면 아래 branch -d 가 'already checked out' 으로 거부당한다.
        if (!isDefault && (hasRegisteredWorktree || worktreeReady(gitWorktreePath))) {
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

        if (!isDefault) {
            auto deleted = GitRunner::deleteBranch(localPath, name, force);
            if (!deleted.ok()) {
                // 원격에만 있고 아직 로컬 브랜치를 만들지 않은 경우엔 지울 것이 없다.
                LOG_WARN << "로컬 브랜치 삭제 건너뜀 (" << name << "): " << trim(deleted.err);
            }
        }

        auto result = db->execSqlSync("SELECT * FROM delete_github_branch($1, $2, $3)", requester, repoId, name);

        // 삭제 확정을 같은 저장소 전체에 알린다. 그 브랜치에 있던 사용자는 클라이언트가 기본 브랜치로 옮긴다(§1.3-10).
        Json::Value deleted;
        deleted["type"] = "branch_deleted";
        deleted["repo_id"] = repoId;
        deleted["branch"] = name;
        deleted["default_branch"] = defaultBranch;
        GithubWebSocketController::broadcastToRepository(repoId, deleted);

        return successResponse(rowsToArray(result), "브랜치를 삭제했습니다.");
    });
}

// ===========================================================================
// 작업 트리: 상태 / 스테이징 / 수동 fetch (§1.3-8, §1.4)
// ===========================================================================

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
    runOffLoop(std::move(callback), [requester, repoId, branch]() -> HttpResponsePtr {
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
// 인덱스에 올라갈 수 있다 — 그래서 add 앞에서 그 방을 강제 flush 한다(§12.11).
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

    runOffLoop(std::move(callback), [requester, repoId, branch, paths]() -> HttpResponsePtr {
        std::string workDir;
        HttpResponsePtr failure;
        if (!resolveWorkDir(requester, repoId, branch, workDir, failure)) {
            return failure;
        }

        // 방금 친 내용이 아직 파일이 되지 않았을 수 있다 — 옛 내용이 인덱스에 올라가지 않게 먼저 내려쓴다.
        // collab 이 죽어 있으면 그냥 진행한다(커밋과 같은 규칙: collab 때문에 스테이징을 막지 않는다).
        flushCollabDocs(repoId, branch);

        auto staged = GitRunner::stageAdd(workDir, paths);
        if (!staged.ok()) {
            return errorResponse("P0807", "스테이징하지 못했습니다: " + trim(staged.err), k500InternalServerError);
        }

        // 인덱스가 바뀌었다 — 같은 브랜치의 다른 사용자도 Staged/Changes 그룹을 다시 그린다(§15.10).
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

    runOffLoop(std::move(callback), [requester, repoId, branch, paths]() -> HttpResponsePtr {
        std::string workDir;
        HttpResponsePtr failure;
        if (!resolveWorkDir(requester, repoId, branch, workDir, failure)) {
            return failure;
        }

        auto unstaged = GitRunner::stageRemove(workDir, paths);
        if (!unstaged.ok()) {
            return errorResponse("P0807", "스테이징을 해제하지 못했습니다: " + trim(unstaged.err), k500InternalServerError);
        }

        // 해제도 인덱스를 바꾼다 — 같은 브랜치의 다른 사용자도 그룹을 다시 그린다(§15.10).
        broadcastStatusChanged(repoId, branch);

        GitResult statusResult;
        const Json::Value entries = readWorktreeStatus(workDir, statusResult);
        return successResponse(entries, "스테이징을 해제했습니다.");
    });
}

// POST /api/github/repos/discard — 되돌리기(§12.11.1).
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

    runOffLoop(std::move(callback), [requester, repoId, branch, paths]() -> HttpResponsePtr {
        std::string workDir;
        HttpResponsePtr failure;
        if (!resolveWorkDir(requester, repoId, branch, workDir, failure)) {
            return failure;
        }

        // 커밋과 같은 이유로 저장소 단위로 직렬화한다(index.lock 경합 방지, §12.11).
        std::lock_guard<std::mutex> guard(*repoLock(repoId));

        // 1) 되돌릴 내용을 git 에서 먼저 읽는다. HEAD 에 있으면 그 내용, 없으면 새로 만든 파일이라 지운다.
        Json::Value files(Json::arrayValue);   // collab 에게 줄 되돌리기 목록
        std::vector<std::string> tracked;      // git restore 대상
        std::vector<std::string> fresh;        // 지울 대상(HEAD 에 없음)
        // collab 은 512KB 를 넘는 파일을 doc 으로 열지 않는다(§12.6). 그런 파일은 되돌릴 doc 이 없으니
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

        // 2) collab 을 먼저 맞추고 **끝날 때까지 기다린다**. 열려 있는 doc 이 옛 텍스트를 그대로 들고 있으면
        //    다음 flush 가 되돌리기를 무르고, 늦게 도착한 그 쓰기가 아래 git 체크아웃과 겹치면 `File exists` 로 죽는다.
        resetCollabDocs(repoId, branch, files);

        // 3) 작업 트리와 인덱스를 되돌린다.
        for (const auto &path : tracked) {
            auto restored = GitRunner::run(workDir, {"restore", "--source=HEAD", "--staged", "--worktree", "--", path});
            if (!restored.ok()) {
                // git 체크아웃은 그 경로가 비어 있다고 본 뒤 O_CREAT|O_EXCL 로 새로 만든다(entry.c). 위에서 collab 을
                // 기다렸어도 그 사이 누가 그 경로를 만들면 `File exists` 로 죽는다 — 경로를 비우고 한 번 더 시도한다.
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

        // 인덱스·작업 트리가 바뀌었다 — 같은 브랜치의 다른 사용자에게도 알린다(§15.10).
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

// POST /api/github/repos/fetch — 수동 fetch --all --prune.
// 자동 fetch 만 두면 push 가 non-fast-forward 로 막히므로 수동 트리거를 반드시 둔다(§1.4).
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

    runOffLoop(std::move(callback), [requester, repoId, branch]() -> HttpResponsePtr {
        auto db = app().getDbClient();

        Json::Value repoRow;
        if (!singleRow(db->execSqlSync("SELECT * FROM get_github_repository_by_id($1, $2)", requester, repoId), repoRow)) {
            return errorResponse("P0801", "연결된 저장소를 찾을 수 없습니다.", k404NotFound);
        }
        const std::string localPath = repoRow["local_path"].asString();

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

        // fetch 는 원격 추적 ref 만 바꾸지만 ahead/behind 뱃지도 상태다 — 다른 사용자에게도 알린다(§15.10).
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
// ===========================================================================
// 커밋 (§3.2 POST /api/github/repos/commits, §12.11 커밋 파이프라인)
// ===========================================================================

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

    // paths 를 생략하면 커밋되지 않은 변경 전체를 커밋한다(§3.2).
    const std::vector<std::string> paths = jsonStringArray((*jsonPtr)["paths"]);

    // identity 는 '검증만' 한다(§2.4). 실제 작성자는 서버가 확정한다.
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
    runOffLoop(std::move(callback),
               [requester, repoId, branch, message, paths, identityName, identityEmail]() -> HttpResponsePtr {
        auto db = app().getDbClient();

        // 1) 로그인 계정에서 작성자를 확정한다(요청 바디를 신뢰하지 않는다, §12.11).
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

        // 2) 브랜치의 작업 디렉터리를 확정한다(없으면 worktree 를 만든다).
        std::string workDir;
        HttpResponsePtr failure;
        if (!resolveWorkDir(requester, repoId, branch, workDir, failure)) {
            return failure;
        }

        // 3) 커밋 시작을 같은 브랜치 접속자에게 알린다(§1.3-7). 확장은 이때 입력을 잠근다.
        Json::Value started;
        started["type"] = "commit_started";
        started["repo_id"] = repoId;
        started["branch"] = branch;
        started["email"] = requester;
        GithubWebSocketController::broadcastToBranch(repoId, branch, started);

        // 4) 같은 저장소의 커밋은 직렬화한다(§12.11: git index.lock 경합 방지).
        std::lock_guard<std::mutex> commitGuard(*repoLock(repoId));

        // 5) 커밋 대상 스테이징 → 커밋.
        //    실제 'git add' 는 그 브랜치의 collab flush 가 끝난 뒤에 해야 한다(§12.11) — 편집은
        //    디바운스(기본 2초) 뒤에 파일이 되므로, 안 기다리면 방금 친 내용이 커밋에서 빠진다.
        //    collab 이 없거나 응답이 없으면 그대로 진행한다: 커밋 자체를 막지 않는다.
        flushCollabDocs(repoId, branch);

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

        // 6) 커밋은 로컬에만 남긴다(§12.11). 원격 전송은 별도 push(POST /api/github/repos/push)가 맡는다.
        //    그래서 커밋 로그는 pushed=false 로 남고, push 가 성공하면 mark_github_branch_pushed 가 뒤집는다.
        const bool pushed = false;

        // 7) 커밋 로그를 남기고 메시지의 WI-xxx 를 업무로 해석한다(§12.11).
        Json::Value commitRow;
        if (!singleRow(db->execSqlSync("SELECT * FROM create_github_commit_log($1, $2, $3, $4, $5, $6, $7)",
                                       requester, repoId, branch, sha, authorEmail, message, pushed),
                       commitRow)) {
            return errorResponse("P0807", "커밋 기록을 저장하지 못했습니다.", k500InternalServerError);
        }

        // 8) 매칭된 업무가 아직 'todo' 면 첫 커밋으로 보고 'in_progress' 로 전환한다.
        //    전환은 강제가 아니며, 실패해도 커밋 자체는 성공으로 둔다(§12.11).
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

        // 9) 응답 조립(§3.2). 커밋은 로컬에만 남으므로 pushed=false 이고, 남은 push 대기 수(ahead)를 함께 알린다.
        //    원격 전송은 별도 push 커맨드가 맡는다(§12.11) — 여기서는 push 하지 않는다.
        const SyncState sync = readSyncState(workDir, branch);
        commitRow["pushed"] = false;
        commitRow["ahead"] = sync.ahead;
        commitRow["behind"] = sync.behind;
        commitRow["has_upstream"] = sync.hasUpstream;
        commitRow["status_transition"] = transition;

        Json::Value data(Json::arrayValue);
        data.append(commitRow);

        // 커밋 결과를 같은 브랜치 접속자에게 알린다(§1.3-7). 확장은 이때 입력 잠금을 풀고 트리를 새로 고친다.
        Json::Value finished;
        finished["type"] = "commit_finished";
        finished["repo_id"] = repoId;
        finished["branch"] = branch;
        finished["sha"] = sha;
        finished["email"] = requester;
        finished["pushed"] = false;
        finished["ahead"] = sync.ahead;
        GithubWebSocketController::broadcastToBranch(repoId, branch, finished);

        return successResponse(data, "커밋했습니다. 원격 전송은 push 로 따로 합니다.", k201Created);
    });
}

// GET /api/github/repos/sync?repo_id=3&branch=main — 현재 브랜치가 원격보다 얼마나 앞섰는지 (§3.2).
// 커밋·push 버튼의 상태와 graph 뷰(§15.13)의 "원격 위치" 표시가 이 값을 쓴다.
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
    runOffLoop(std::move(callback), [requester, repoId, branch]() -> HttpResponsePtr {
        std::string workDir;
        HttpResponsePtr failure;
        if (!resolveWorkDir(requester, repoId, branch, workDir, failure)) {
            return failure;
        }

        const SyncState state = readSyncState(workDir, branch);
        return successResponse(singleItemArray(syncToJson(state)), "원격 대비 상태를 조회했습니다.");
    });
}

// POST /api/github/repos/push — 커밋한 내용을 원격으로 올린다 (§3.2, §12.11).
// 커밋(로컬 저장)과 분리된 별도 동작이다 — 로컬에만 쌓아 두고 싶은 경우를 위해 push 를 따로 둔다.
// push 는 요청한 사용자의 자격증명으로만 하며(§6-4), 성공하면 그 브랜치의 미push 커밋 로그를 확정한다.
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
    runOffLoop(std::move(callback), [requester, repoId, branch]() -> HttpResponsePtr {
        auto db = app().getDbClient();

        std::string workDir;
        HttpResponsePtr failure;
        if (!resolveWorkDir(requester, repoId, branch, workDir, failure)) {
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

        // 자격증명이 없으면 커밋은 그대로 두고 사유만 알린다(§12.11).
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

        // 같은 저장소의 커밋·push 는 직렬화한다(§12.11: index.lock 경합 방지).
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
        try {
            Json::Value markRow;
            if (singleRow(db->execSqlSync("SELECT * FROM mark_github_branch_pushed($1, $2, $3)",
                                          requester, repoId, branch),
                          markRow)) {
                data["pushed_commit_count"] = markRow["pushed_commit_count"];
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

        return successResponse(singleItemArray(data), "원격에 push 했습니다.");
    });
}

// ===========================================================================
// 앱 → 확장 핸드오프 / 확장 세션 (§3.4, §12.1)
// ===========================================================================

// POST /api/github/handoff — 앱이 VSCode 확장에 넘길 1회용 코드를 발급한다 (§3.4).
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

    runOffLoop(std::move(callback), [requester, nodeId, repoId]() -> HttpResponsePtr {
        auto db = app().getDbClient();
        // 권한·저장소-노드 일치 검사는 SQL 함수가 수행한다(불일치면 P0801).
        auto result = db->execSqlSync("SELECT * FROM create_github_handoff_code($1, $2, $3)",
                                      requester, nodeId, repoId);
        return successResponse(rowsToArray(result), "확장에서 사용할 1회용 코드를 발급했습니다.", k201Created);
    });
}

// POST /api/github/sessions — 1회용 코드를 확장 전용 토큰으로 교환한다 (§3.4, §12.1).
// 인증 없는 라우트다(JwtFilter 미적용) — 확장은 이 호출로 토큰을 처음 받기 때문이다.
void GithubController::exchangeSession(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    auto jsonPtr = req->getJsonObject();
    if (!jsonPtr || !validateStrings(jsonPtr, "code")) {
        callback(errorResponse("400", "필수 파라미터(code)가 누락되었습니다.", k400BadRequest));
        return;
    }

    const std::string code = (*jsonPtr)["code"].asString();

    runOffLoop(std::move(callback), [code]() -> HttpResponsePtr {
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
        //    앱의 user_refresh_tokens 와 분리해야 서로의 세션을 무효화하지 않는다(§12.1).
        db->execSqlSync("SELECT * FROM create_github_extension_token($1, $2, $3)",
                        email, tokens["refresh_token"].asString(), tokens["refresh_token_expiry"].asString());

        // 4) 응답 조립. 토큰은 이 응답에서만 나가고 로그·에러 메시지에는 넣지 않는다(§5).
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

// POST /api/github/sessions/refresh — 확장 토큰 자동 갱신 (§12.1).
// 앱의 /api/users/refresh 와 같은 방식이되, 확장 전용 테이블만 본다(앱 세션과 분리).
void GithubController::refreshSession(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    auto jsonPtr = req->getJsonObject();
    if (!jsonPtr || !validateStrings(jsonPtr, "refresh_token")) {
        callback(errorResponse("400", "필수 파라미터(refresh_token)가 누락되었습니다.", k400BadRequest));
        return;
    }

    const std::string refreshToken = (*jsonPtr)["refresh_token"].asString();

    runOffLoop(std::move(callback), [refreshToken]() -> HttpResponsePtr {
        auto db = app().getDbClient();

        // 1) 이 토큰의 주인을 먼저 찾는다. 만료된 토큰은 여기서 걸러진다.
        auto owner = db->execSqlSync(
            "SELECT user_email FROM github_extension_tokens WHERE refresh_token = $1 AND expires_at > CURRENT_TIMESTAMP",
            refreshToken);
        if (owner.empty()) {
            return errorResponse("P0812", "확장 세션이 만료되었습니다. 앱에서 다시 연결해 주세요.", k401Unauthorized);
        }
        const std::string email = owner[0]["user_email"].as<std::string>();

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