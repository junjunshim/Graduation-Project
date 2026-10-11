#include "CollabClient.h"

#include <drogon/drogon.h>

#include <chrono>
#include <cstdlib>
#include <exception>
#include <future>
#include <memory>

using namespace drogon;

namespace app_utils
{
namespace
{
// collab 내부 API 를 부르고 **응답을 기다리는** 상한(초). 같은 호스트 안이라 짧아도 충분하고,
// 이 시간을 넘기면 collab 이 죽었다고 보고 그냥 진행한다.
constexpr int kCollabCallWaitSeconds = 3;

// 권한 변경 통보는 위 두 경우와 달리 "기다릴 이유"가 없다(파일 쓰기와 겹치지 않는다).
// 그래도 호출 경로가 하나뿐이라 같은 상한을 그대로 쓴다.
constexpr char kPermissionPath[] = "/internal/collab/permission";

// 저장소(방)를 통째로 닫으라는 통보(노드 삭제, §12.9). 권한 변경과 달리 저장소 여러 개를 한 번에 보낸다.
constexpr char kRepoClosePath[] = "/internal/collab/repo/close";
}  // namespace

bool callCollabInternal(const std::string &path, const Json::Value &body, Json::Value *outData) {
    const char *baseValue = std::getenv("COLLAB_BASE");
    const char *tokenValue = std::getenv("INTERNAL_TOKEN");
    const std::string collabBase = (baseValue != nullptr) ? std::string(baseValue) : std::string();
    const std::string token = (tokenValue != nullptr) ? std::string(tokenValue) : std::string();
    if (collabBase.empty() || token.empty()) {
        return false;
    }

    const int repoId = body["repo_id"].isInt() ? body["repo_id"].asInt() : 0;
    // 저장소 하나를 다루는 통보(권한 변경·되돌리기·flush)는 repo_id 를 담고, 서브트리 전체를
    // 다루는 통보(노드 삭제)는 repo_ids 배열을 담는다. 로그에 어느 쪽인지 드러나게 한다.
    const int repoCount = body["repo_ids"].isArray() ? static_cast<int>(body["repo_ids"].size()) : 0;
    const std::string repoLabel = repoId > 0 ? std::to_string(repoId) : std::to_string(repoCount) + "개";

    // HttpClient 는 생성한 루프에서 호출해야 한다. 우리는 작업 스레드에 있으므로 메인 루프로 올리고,
    // 이 스레드는 promise 로 응답을 기다린다 — 기다리지 않으면 collab 의 쓰기와 git 작업이 겹친다.
    auto done = std::make_shared<std::promise<bool>>();
    // 200 응답의 `data` 배열을 담아 둘 곳. 워커 스택이 아니라 shared_ptr 에 담는다 — 응답이 늦어
    // 타임아웃으로 워커가 먼저 빠져나가도 콜백이 죽은 스택을 건드리지 않게 하기 위함이다.
    auto payload = std::make_shared<Json::Value>(Json::arrayValue);
    std::future<bool> future = done->get_future();
    app().getLoop()->queueInLoop([collabBase, token, path, body, repoLabel, done, payload]() {
        auto client = HttpClient::newHttpClient(collabBase, app().getLoop());
        auto request = HttpRequest::newHttpJsonRequest(body);
        request->setMethod(Post);
        request->setPath(path);
        request->addHeader("X-Internal-Token", token);

        client->sendRequest(request, [client, path, repoLabel, done, payload](ReqResult result, const HttpResponsePtr &response) {
            const bool ok = (result == ReqResult::Ok && response != nullptr &&
                             response->getStatusCode() == k200OK);
            if (ok) {
                // 호출자가 응답 내용(예: flush 의 `failed`)을 봐야 하므로 `data` 배열을 옮겨 둔다.
                Json::Value parsed;
                Json::Reader reader;
                if (reader.parse(std::string(response->getBody()), parsed) && parsed["data"].isArray()) {
                    *payload = parsed["data"];
                }
            } else {
                LOG_WARN << "collab 호출 실패. path=" << path << " repo=" << repoLabel
                         << " result=" << static_cast<int>(result)
                         << " status=" << ((response == nullptr) ? 0 : static_cast<int>(response->getStatusCode()));
            }
            done->set_value(ok);
        });
    });

    if (future.wait_for(std::chrono::seconds(kCollabCallWaitSeconds)) != std::future_status::ready) {
        LOG_WARN << "collab 호출 응답 없음(기다리지 않고 진행). path=" << path << " repo=" << repoLabel;
        return false;
    }
    const bool ok = future.get();
    if (ok && outData != nullptr) {
        *outData = *payload;
    }
    return ok;
}

void notifyPermissionChanged(int repoId, const std::vector<CollabPermissionEntry> &users) {
    if (repoId <= 0) {
        return;
    }

    // 알릴 사람이 한 명도 없으면 부르지 않는다 — collab 도 할 일이 없다.
    Json::Value list(Json::arrayValue);
    for (const auto &user : users) {
        if (user.userEmail.empty()) {
            continue;
        }
        Json::Value item;
        item["user_email"] = user.userEmail;
        item["can_view"] = user.canView;
        item["can_write"] = user.canWrite;
        list.append(item);
    }
    if (list.empty()) {
        return;
    }

    Json::Value body;
    body["repo_id"] = repoId;
    body["users"] = list;
    callCollabInternal(kPermissionPath, body);
}

void notifyReposClosed(const std::vector<int> &repoIds, const std::string &reason) {
    Json::Value ids(Json::arrayValue);
    for (const int repoId : repoIds) {
        if (repoId > 0) {
            ids.append(repoId);
        }
    }
    if (ids.empty()) {
        return;
    }

    Json::Value body;
    body["repo_ids"] = ids;
    body["reason"] = reason;
    callCollabInternal(kRepoClosePath, body);
}
}  // namespace app_utils
