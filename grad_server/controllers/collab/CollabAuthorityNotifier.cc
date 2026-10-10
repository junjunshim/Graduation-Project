#include "CollabAuthorityNotifier.h"

#include "CollabClient.h"
#include "GithubWebSocketController.h"

#include <drogon/drogon.h>

#include <exception>
#include <map>
#include <string>
#include <thread>
#include <vector>

using namespace drogon;
using namespace app_utils;

namespace api
{
namespace
{
// 보기 권한을 잃어 강제 이탈시킨 사용자에게 보여 줄 문구와 close reason. 제어 소켓과 문서 소켓이
// 같은 말을 하도록 한 곳에 둔다(close reason 은 WebSocket 규격상 ASCII 로 짧게).
constexpr char kAuthorityLostMessage[] = "이 워크스페이스에 대한 권한이 없어 연결을 종료했습니다.";
constexpr char kAuthorityLostReason[] = "authority_lost";

// 노드 권한이 바뀐 뒤, 그 노드의 서브트리 저장소에 **지금 붙어 있는** 사용자의 새 권한을 읽어
// 두 소켓에 반영한다. 판정은 DB 함수(`get_collab_permission_targets`) 하나가 한다 — C++ 은 그
// 결과를 나르기만 한다(§12.9). 워커 스레드에서 부른다(동기 DB + 내부 HTTP 호출).
void notifyAuthorityChanged(const orm::DbClientPtr &db, int node_id)
{
    auto rows = db->execSqlSync(
        "SELECT repo_id, user_email, can_view, can_write FROM get_collab_permission_targets($1)", node_id);

    // 통보는 저장소 단위다 — collab 의 방이 (저장소, 브랜치)로 나뉘어 있기 때문이다.
    std::map<int, std::vector<CollabPermissionEntry>> byRepo;
    std::map<int, std::vector<std::string>> viewLost;
    for (std::size_t i = 0; i < rows.size(); ++i)
    {
        const int repoId = rows[i]["repo_id"].as<int>();
        CollabPermissionEntry entry;
        entry.userEmail = rows[i]["user_email"].as<std::string>();
        entry.canView = rows[i]["can_view"].as<bool>();
        entry.canWrite = rows[i]["can_write"].as<bool>();
        byRepo[repoId].push_back(entry);
        if (!entry.canView)
        {
            viewLost[repoId].push_back(entry.userEmail);
        }
    }

    int viewLostCount = 0;
    for (const auto &repo : byRepo)
    {
        const int repoId = repo.first;
        // 1. 문서 소켓(collab)에 알린다 — 쓰기 회수·복구는 `perm`, 보기 상실은 세션 종료.
        notifyPermissionChanged(repoId, repo.second);

        // 2. 제어 소켓은 이 서버가 직접 닫는다. 접속자 행 정리와 남은 사람 알림은 소켓 종료
        //    경로(handleConnectionClosed)가 맡는다.
        auto lost = viewLost.find(repoId);
        if (lost != viewLost.end())
        {
            GithubWebSocketController::closeRepositorySessionsForUsers(repoId, lost->second,
                                                                      kAuthorityLostReason,
                                                                      kAuthorityLostMessage);
            viewLostCount += static_cast<int>(lost->second.size());
        }
    }

    if (!byRepo.empty())
    {
        LOG_INFO << "collab 권한 변경 통보: node=" << node_id << " repo=" << byRepo.size()
                 << " user=" << rows.size() << " 보기상실=" << viewLostCount;
    }
}
}  // namespace

void notifyAuthorityChangedAsync(int node_id)
{
    if (node_id <= 0)
    {
        return;
    }

    std::thread worker([node_id]() {
        try
        {
            notifyAuthorityChanged(app().getDbClient(), node_id);
        }
        catch (const std::exception &e)
        {
            LOG_WARN << "collab 권한 변경 통보 실패: node=" << node_id << " reason=" << e.what();
        }
    });
    worker.detach();
}

void closeNodeSessionsAsync(int node_id)
{
    if (node_id <= 0)
    {
        return;
    }

    std::thread worker([node_id]() {
        try
        {
            auto db = app().getDbClient();
            // 서브트리 전체의 저장소. delete_node 가 트리거로 자손까지 소프트 딜리트했으므로 이
            // 시점에 노드는 이미 is_deleted = TRUE 다 — 그래서 함수가 노드의 is_deleted 를 보지 않는다.
            auto rows = db->execSqlSync("SELECT repo_id FROM get_collab_repos_in_subtree($1)", node_id);

            std::vector<int> repoIds;
            repoIds.reserve(rows.size());
            for (std::size_t i = 0; i < rows.size(); ++i)
            {
                repoIds.push_back(rows[i]["repo_id"].as<int>());
            }
            if (repoIds.empty())
            {
                return;
            }

            // 1. 제어 소켓부터 끊는다. 접속자 행(presence) 정리는 소켓 종료 경로가 맡는다.
            GithubWebSocketController::closeRepositorySessions(repoIds, "node_deleted",
                                                               "이 워크스페이스가 삭제되었습니다.");
            // 2. 문서 소켓(collab)도 닫는다 — 열려 있던 편집을 파일로 내려쓴 뒤 세션을 끝낸다.
            notifyReposClosed(repoIds, "node_deleted");
        }
        catch (const std::exception &e)
        {
            LOG_WARN << "노드 삭제 협업 세션 정리 실패: node=" << node_id << " reason=" << e.what();
        }
    });
    worker.detach();
}
}  // namespace api
