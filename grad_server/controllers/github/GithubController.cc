#include "GithubController.h"
#include "ResponseUtils.h"
#include "ValidationUtils.h"
#include "GitRunner.h"

#include <drogon/HttpClient.h>
#include <json/json.h>

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <filesystem>
#include <memory>
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

// ---------------------------------------------------------------------------
// 환경/설정
// ---------------------------------------------------------------------------

// 자격증명 암호화 키는 환경변수에서만 읽는다. 없으면 자격증명을 저장하지 않는다 (§5, fail-closed).
std::string credentialKey() {
    const char *value = std::getenv("GITHUB_TOKEN_KEY");
    return (value != nullptr) ? std::string(value) : std::string();
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
            std::filesystem::create_directories("repository/" + std::to_string(nodeId), ec);
            auto cloned = GitRunner::clone("repository/" + std::to_string(nodeId), url, repo,
                                           authenticated ? &auth : nullptr);
            if (!cloned.ok()) {
                LOG_WARN << "git clone 실패 (" << url << "): " << trim(cloned.err);
                return errorResponse("P0808", "저장소를 clone 하지 못했습니다. 주소와 접근 권한을 확인해 주세요.", k502BadGateway);
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
        const std::string ref = branch.empty() ? repoRow["default_branch"].asString() : branch;

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

    const std::string requester = requesterEmail(req);
    runOffLoop(std::move(callback), [requester, repoId, branch, path]() -> HttpResponsePtr {
        auto db = app().getDbClient();
        Json::Value repoRow;
        if (!singleRow(db->execSqlSync("SELECT * FROM get_github_repository_by_id($1, $2)", requester, repoId), repoRow)) {
            return errorResponse("P0801", "연결된 저장소를 찾을 수 없습니다.", k404NotFound);
        }

        const std::string localPath = repoRow["local_path"].asString();
        const std::string ref = branch.empty() ? repoRow["default_branch"].asString() : branch;
        const std::string spec = treeishOf(ref, path);

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

        // 2) 상한 초과는 읽기 전용 (§12.6)
        if (size > kMaxTextFileBytes) {
            data["read_only"] = true;
            data["reason"] = "too_large";
            return successResponse(data, "파일이 너무 커서 읽기 전용으로 표시했습니다.");
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
            return successResponse(data, "바이너리 파일이라 읽기 전용으로 표시했습니다.");
        }

        data["content"] = content.out;
        data["eol"] = (content.out.find("\r\n") != std::string::npos) ? "crlf" : "lf";
        return successResponse(data, "파일을 조회했습니다.");
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

        // 이름순 정렬 (DB 순서와 원격 순서가 섞이지 않게).
        // Json::Value 의 반복자는 양방향이라 std::sort 를 쓸 수 없다. vector 로 옮겨 정렬한 뒤 다시 배열로 만든다.
        std::vector<Json::Value> ordered(branches.begin(), branches.end());
        std::sort(ordered.begin(), ordered.end(), [](const Json::Value &a, const Json::Value &b) {
            return a["name"].asString() < b["name"].asString();
        });

        Json::Value sorted(Json::arrayValue);
        for (const auto &item : ordered) {
            sorted.append(item);
        }

        return successResponse(sorted, "브랜치 목록을 조회했습니다.");
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