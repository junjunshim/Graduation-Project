#include <drogon/drogon.h>
#include <json/json.h>
#include <fstream>
#include <iostream>
#include <algorithm>
#include <cstdlib>
#include <filesystem>
#include <thread>
#include <vector>
#include "NotificationWebSocketController.h"
#include "GitRunner.h"
#include "WorkerLimiter.h"

namespace {

// worktree 회수 기본값. config.json 의 custom_config 나 env(WORKTREE_IDLE_DAYS / WORKTREE_MAX_PER_REPO)로
// 바꿀 수 있다. 30일은 "이번 달에 안 쓴 브랜치", 20개는 저장소 하나가 동시에 들고 있을 작업 사본 수
// 상한이다(사본 하나가 저장소 크기만큼 디스크를 쓴다).
constexpr int kDefaultWorktreeIdleDays = 30;
constexpr int kDefaultWorktreeMaxPerRepo = 20;

// stderr 의 첫 줄만 남긴다(줄바꿈이 그대로 들어가면 로그가 여러 줄로 깨진다).
std::string firstLine(const std::string &text) {
    const auto pos = text.find('\n');
    return (pos == std::string::npos) ? text : text.substr(0, pos);
}

// 브랜치 worktree 회수. 브랜치마다 작업 파일 사본이 통째로 생겨 디스크가 브랜치 수만큼 늘어나므로,
// 오래 안 쓴 브랜치의 작업 디렉터리를 캐시처럼 비운다. 회수는 삭제가 아니다 — 브랜치 행과 커밋한
// 내용은 clone 의 ref·오브젝트에 그대로 남고, 다시 열면 ensureWorktree 가 같은 자리에 되살린다.
//
// 두 규칙을 함께 본다: 유휴 회수(idleDays 초과)와 저장소별 상한(maxPerRepo 초과, 오래 안 쓴 것부터).
// 후보 자격(접속자 없음·기본 브랜치 아님·최근에 안 씀)은 DB 함수가 판정하고, 디렉터리가 실제로 남아
// 있는지는 여기서 본다 — DB 는 파일 시스템을 모른다. 커밋하지 않은 변경이 남은 작업 트리는 지우지
// 않는다(지우면 되돌릴 수 없다). 지우지 못한 브랜치는 후보를 매번 새로 계산하므로 다음 실행에서 다시
// 시도된다.
//
// git 실행과 동기 DB 호출이 들어 있어 워커 스레드에서만 부른다 — IO 스레드에서 돌리면 그 동안 모든
// 요청이 멈춘다.
void reclaimIdleWorktrees(int idleDays, int maxPerRepo) {
    auto db = drogon::app().getDbClient();

    struct Candidate {
        int repoId = 0;
        std::string branch;
        std::string localPath;
        std::string worktreePath;
        bool idle = false;      // 유휴 규칙(idleDays)에 걸린 후보
    };

    // 후보는 저장소별 "사용 시각 내림차순"이다 — 앞에서부터 세면 그 순서가 곧 최근 사용 순서(LRU)다.
    std::vector<Candidate> candidates;
    for (const auto &row : db->execSqlSync("SELECT * FROM list_worktree_reclaim_candidates($1)", idleDays)) {
        Candidate item;
        item.repoId = row["repo_id"].as<int>();
        item.branch = row["branch_name"].as<std::string>();
        item.localPath = row["local_path"].as<std::string>();
        item.worktreePath = row["worktree_path"].as<std::string>();
        item.idle = row["idle"].as<bool>();
        candidates.push_back(item);
    }

    // 지울 대상 고르기. 이미 회수된 브랜치는 후보에 계속 남지만 지울 것이 없으므로, 상한 계산에서도
    // 빼야 "지금 디스크에 남아 있는 개수"를 정확히 센다.
    std::vector<size_t> targets;
    int present = 0;   // 지금 남아 있는 작업 디렉터리 수(상한 계산·로그에 쓴다)
    int rank = 0;
    int lastRepo = 0;
    for (size_t i = 0; i < candidates.size(); ++i) {
        if (i == 0 || candidates[i].repoId != lastRepo) {
            lastRepo = candidates[i].repoId;
            rank = 0;
        }

        std::error_code existsError;
        if (!std::filesystem::exists(candidates[i].worktreePath, existsError) || existsError) {
            continue;
        }
        present += 1;
        rank += 1;

        if (candidates[i].idle || (maxPerRepo > 0 && rank > maxPerRepo)) {
            targets.push_back(i);
        }
    }

    int removed = 0;
    int skipped = 0;
    for (size_t index : targets) {
        const Candidate &item = candidates[index];

        // 커밋하지 않은 변경이 남은 작업 트리는 지우지 않는다 — 추적되지 않는 파일도 사용자의 것이다.
        auto status = app_utils::GitRunner::run(item.worktreePath, {"status", "--porcelain=v1", "--untracked-files=all"});
        if (!status.ok() || !status.out.empty()) {
            LOG_WARN << "[worktree] 커밋되지 않은 변경이 남아 있어 회수하지 않습니다: " << item.worktreePath;
            skipped += 1;
            continue;
        }

        auto removedResult = app_utils::GitRunner::worktreeRemove(item.localPath, item.worktreePath, true);
        if (!removedResult.ok()) {
            // git 이 모르는 디렉터리(과거 흔적·손으로 지운 worktree)면 직접 지우고 등록 정보를 청소한다.
            LOG_WARN << "[worktree] git worktree remove 실패(" << removedResult.exitCode << ": "
                     << firstLine(removedResult.err) << ") — 직접 지웁니다: " << item.worktreePath;
            std::error_code removeError;
            std::filesystem::remove_all(item.worktreePath, removeError);
            app_utils::GitRunner::run(item.localPath, {"worktree", "prune"});
            if (removeError) {
                LOG_WARN << "[worktree] 직접 지우기도 실패했습니다: " << item.worktreePath << " ("
                         << removeError.message() << ")";
                skipped += 1;
                continue;
            }
        }

        removed += 1;
        LOG_INFO << "[worktree] 회수 완료: repo=" << item.repoId << " branch=" << item.branch
                 << (item.idle ? " (유휴)" : " (상한)");
    }

    LOG_INFO << "[Scheduler] worktree 회수 완료 — 삭제 " << removed << "개, 건너뜀 " << skipped
             << "개 (남아 있는 작업 디렉터리 " << present << "개, 후보 " << candidates.size() << "개)";
}

// purge_expired_deleted_data 에 넘길 "1,2,3" 형태. 빈 목록은 ""(SQL 쪽에서 "실패 없음"으로 본다).
std::string joinIds(const std::vector<int> &ids) {
    std::string joined;
    for (const int id : ids) {
        if (!joined.empty()) {
            joined += ',';
        }
        joined += std::to_string(id);
    }
    return joined;
}

// 휴지통 15일 만료 데이터 정리(Hard Delete).
//
// 지우는 순서가 핵심이다: 물리 파일을 먼저 지우고, 지우지 못한 항목의 id 를 모아 purge 함수에 넘기면
// 그 행만 남아 다음 회차에 자동으로 다시 시도된다. 반대로 행을 먼저 지우면 실패한 경로를 다시 알 수
// 없어 영구 잔여물이 된다. 무엇이 만료됐는지, CASCADE 로 무엇이 함께 사라지는지는 DB 함수가 판단하고,
// 서버는 "디스크에서 실제로 지웠는가"만 본다 — DB 는 파일 시스템을 모른다.
//
// 동기 DB 호출과 파일 삭제가 들어 있어 워커 스레드에서만 부른다.
void purgeExpiredDeletedData() {
    auto db = drogon::app().getDbClient();

    // 서버가 관리하는 경로만 지운다. DB 값이 오염돼도 이 접두사 밖은 건드리지 않는다(업무·정기 일정
    // 첨부는 './uploads/...', 저장소는 'repository/...'). 앞의 './' 만 떼고 접두사를 본다.
    const auto isManagedPath = [](std::string path) {
        if (path.rfind("./", 0) == 0) {
            path.erase(0, 2);
        }
        return path.rfind("uploads/", 0) == 0 || path.rfind("repository/", 0) == 0;
    };

    std::vector<int> failedFileIds;           // 업무 첨부를 못 지웠다 — 이 행은 남긴다
    std::vector<int> failedRecurringFileIds;  // 정기 일정 첨부를 못 지웠다 — 이 행도 남긴다
    std::vector<int> failedChatFileIds;       // 채팅 첨부를 못 지웠다 — 이 행은 남긴다
    std::vector<int> failedRepoIds;           // clone/worktree 를 못 지웠다 — 이 행은 남긴다
    int removed = 0;                          // 실제로 지운 경로 수(로그용)

    // 지우지 못한 id 는 ref_type 별로 따로 모은다 — purge 함수가 각각 다른 표를 보기 때문이다.
    const auto markFailed = [&](const std::string &refType, int refId) {
        if (refType == "FILE") {
            failedFileIds.push_back(refId);
        } else if (refType == "RECURRING_FILE") {
            failedRecurringFileIds.push_back(refId);
        } else if (refType == "CHAT_FILE") {
            failedChatFileIds.push_back(refId);
        } else {
            failedRepoIds.push_back(refId);
        }
    };

    for (const auto &row : db->execSqlSync("SELECT * FROM list_expired_deleted_paths()")) {
        const std::string refType = row["ref_type"].as<std::string>();
        const int refId = row["ref_id"].as<int>();
        const std::string entryPath = row["path"].as<std::string>();
        if (entryPath.empty()) {
            continue;
        }

        // 관리 경로 밖이면 지우지 않는다. 그 행도 실패로 표시해 남긴다 — 지워버리면 경로를 다시 알 수 없다.
        if (!isManagedPath(entryPath)) {
            LOG_WARN << "[Scheduler] Skipped unexpected cleanup path: " << entryPath;
            markFailed(refType, refId);
            continue;
        }

        std::error_code ec;
        if (!std::filesystem::exists(entryPath, ec) || ec) {
            continue;  // 이미 없다 — 지울 것도, 남길 것도 없다
        }

        std::filesystem::remove_all(entryPath, ec);
        if (ec) {
            LOG_WARN << "[Scheduler] Failed to remove path: " << entryPath << " (" << ec.message() << ")";
            markFailed(refType, refId);
            continue;
        }
        removed += 1;
    }

    // 같은 저장소가 clone·worktree 두 줄로 나오므로 중복을 지운다(SQL 인자와 로그 숫자를 짧게 유지).
    const auto dedupe = [](std::vector<int> &ids) {
        std::sort(ids.begin(), ids.end());
        ids.erase(std::unique(ids.begin(), ids.end()), ids.end());
    };
    dedupe(failedFileIds);
    dedupe(failedRecurringFileIds);
    dedupe(failedChatFileIds);
    dedupe(failedRepoIds);

    auto purged = db->execSqlSync("SELECT * FROM purge_expired_deleted_data($1, $2, $3, $4)",
                                  joinIds(failedFileIds), joinIds(failedRepoIds),
                                  joinIds(failedRecurringFileIds), joinIds(failedChatFileIds));

    int purgedFiles = 0;
    int purgedRecurringFiles = 0;
    int purgedRules = 0;
    int purgedItems = 0;
    int purgedRepos = 0;
    int purgedNodes = 0;
    int purgedChatFiles = 0;
    int purgedChatMessages = 0;
    int purgedChannels = 0;
    for (const auto &row : purged) {  // 집계 한 줄이라 반복은 한 번뿐이다
        purgedFiles = row["purged_files"].as<int>();
        purgedRecurringFiles = row["purged_recurring_files"].as<int>();
        purgedRules = row["purged_rules"].as<int>();
        purgedItems = row["purged_work_items"].as<int>();
        purgedRepos = row["purged_repos"].as<int>();
        purgedNodes = row["purged_nodes"].as<int>();
        purgedChatFiles = row["purged_chat_files"].as<int>();
        purgedChatMessages = row["purged_chat_messages"].as<int>();
        purgedChannels = row["purged_channels"].as<int>();
    }

    LOG_INFO << "[Scheduler] 15-day expired cleanup finished. Removed paths: " << removed
             << ", purged rows: files=" << purgedFiles << " recurring_files=" << purgedRecurringFiles
             << " rules=" << purgedRules << " work_items=" << purgedItems << " repos=" << purgedRepos
             << " nodes=" << purgedNodes << " chat_files=" << purgedChatFiles
             << " chat_messages=" << purgedChatMessages << " channels=" << purgedChannels
             << ", 보류(다음 회차 재시도): files=" << failedFileIds.size()
             << " recurring_files=" << failedRecurringFileIds.size()
             << " chat_files=" << failedChatFileIds.size() << " repos=" << failedRepoIds.size();
}

}  // namespace

int main() {
    // 0. 파일 업로드 기본 디렉터리 자동 생성
    try {
        std::filesystem::create_directories("./uploads/work_items");
        std::filesystem::create_directories("./uploads/recurring_rules");
        std::filesystem::create_directories("./uploads/channels");
        // 서버 로컬 저장소 루트(저장소 clone + 브랜치 worktree).
        // docker-compose 의 repository_data 볼륨이 이 위치에 붙는다(uploads 와 같은 CWD 기준 규칙).
        std::filesystem::create_directories("./repository");
    } catch (const std::exception& e) {
        LOG_ERROR << "Failed to initialize uploads directory: " << e.what();
    }

    // 1. 기본 설정 파일 경로
    std::string configPath = "/app/grad_server/config.json";

    // 2. 환경 변수 읽기
    auto getEnv = [](const char* key, const std::string& fallback) {
        const char* value = std::getenv(key);
        return (value && strlen(value) > 0) ? std::string(value) : fallback;
    };

    // 3. Json 설정 덮어쓰기
    std::string dbConnInfo;
    try{
        std::ifstream ifs(configPath);
        Json::Value config;
        ifs >> config;

        // DB 설정 덮어쓰기
        if(config.isMember("db_clients") && config["db_clients"].isArray() && !config["db_clients"].empty()){
            auto& db = config["db_clients"][0];
            db["host"] = getEnv("DB_HOST", db["host"].asString());
            db["port"] = std::stoi(getEnv("DB_PORT", db["port"].asString()));
            db["dbname"] = getEnv("DB_NAME", db["dbname"].asString());
            db["user"] = getEnv("DB_USER", db["user"].asString());
            db["passwd"] = getEnv("DB_PASSWORD", db["passwd"].asString());

            // DB 커넥션 수(사설 풀). 동시 실행 상한보다 넉넉해야 워커가 커넥션을 기다리며 놀지 않는다.
            // config.json 은 git 에 없는 서버 전용 파일이라, 배포에서는 이 env 로 올린다.
            const int currentPool = (db.isMember("number_of_connections") && db["number_of_connections"].isNumeric())
                                        ? db["number_of_connections"].asInt()
                                        : 5;
            db["number_of_connections"] = std::stoi(getEnv("DB_POOL_SIZE", std::to_string(currentPool)));
        }

        // libpq용 연결 문자열(conninfo) 생성
        if(config.isMember("db_clients") && config["db_clients"].isArray() && !config["db_clients"].empty()){
            const auto& db = config["db_clients"][0];
            dbConnInfo = "host=" + db["host"].asString() +
                         " port=" + std::to_string(db["port"].asInt()) +
                         " dbname=" + db["dbname"].asString() +
                         " user=" + db["user"].asString() +
                         " password=" + db["passwd"].asString();
        }

        // jwt 설정 덮어쓰기
        if(config.isMember("custom_config")){
            auto& custom = config["custom_config"];
            custom["jwt_secret"] = getEnv("JWT_SECRET", custom["jwt_secret"].asString());
            custom["access_token_expiry"]  = std::stoi(getEnv("ACCESS_TOKEN_EXPIRY", std::to_string(custom["access_token_expiry"].asInt())));
            custom["refresh_token_expiry"] = std::stoi(getEnv("REFRESH_TOKEN_EXPIRY", std::to_string(custom["refresh_token_expiry"].asInt())));

            // 브랜치 worktree 회수 설정. config.json 에 없으면 기본값을 쓰고 env 가 있으면 덮어쓴다.
            //  - worktree_idle_days   : 이 일수보다 오래 안 쓴 브랜치의 작업 디렉터리를 회수한다(0 이면 유휴 회수 없음).
            //  - worktree_max_per_repo: 저장소 하나가 들고 있을 작업 디렉터리 수 상한(기본 브랜치는 세지 않는다, 0 이면 무제한).
            const int worktreeIdleDays = custom.isMember("worktree_idle_days")
                                             ? custom["worktree_idle_days"].asInt()
                                             : kDefaultWorktreeIdleDays;
            custom["worktree_idle_days"] = std::stoi(getEnv("WORKTREE_IDLE_DAYS", std::to_string(worktreeIdleDays)));
            const int worktreeMaxPerRepo = custom.isMember("worktree_max_per_repo")
                                               ? custom["worktree_max_per_repo"].asInt()
                                               : kDefaultWorktreeMaxPerRepo;
            custom["worktree_max_per_repo"] = std::stoi(getEnv("WORKTREE_MAX_PER_REPO", std::to_string(worktreeMaxPerRepo)));
        }

        drogon::app().loadConfigJson(config);
        drogon::app().enableGzip(true);
        drogon::app().enableBrotli(true);
    } catch (const std::exception& e) {
        LOG_ERROR << "Error loading configuration: " << e.what();
        return 1;
    }

    // 4. 서버 접속 테스트용 핸들러 등록
    drogon::app().registerHandler("/server-test", [](const drogon::HttpRequestPtr&, std::function<void (const drogon::HttpResponsePtr &)> &&callback) {
        auto resp = drogon::HttpResponse::newHttpResponse();
        resp->setBody("TEST => Server is running ");
        callback(resp);
    });
    LOG_INFO << "Server testing handler";

    // 5. DB 접속 테스트용 핸들러 등록
    drogon::app().registerHandler("/db-test", [](const drogon::HttpRequestPtr& req, std::function<void (const drogon::HttpResponsePtr &)> &&callback) {
        auto dbClient = drogon::app().getDbClient(); // 'default' 클라이언트 호출

        // PostgreSQL에 현재 시간을 물어보는 단순 쿼리 실행
        dbClient->execSqlAsync(
            "SELECT now() as current_time",
            [callback](const drogon::orm::Result &result) {
                auto now = result[0]["current_time"].as<std::string>();
                auto resp = drogon::HttpResponse::newHttpResponse();
                resp->setBody("DB Connection Success! DB Current Time: " + now);
                callback(resp);
            },
            [callback](const drogon::orm::DrogonDbException &e) {
                auto resp = drogon::HttpResponse::newHttpResponse();
                resp->setStatusCode(drogon::k500InternalServerError);
                resp->setBody("DB Connection Failed! Error: " + std::string(e.base().what()));
                callback(resp);
            }
        );
    });
    LOG_INFO << "Database teseting handler";


    // 6. CORS 허용 설정 (모든 도메인 및 포트 허용)
    drogon::app().registerPostHandlingAdvice([](const drogon::HttpRequestPtr &req, const drogon::HttpResponsePtr &resp) {
        resp->addHeader("Access-Control-Allow-Origin", "*"); // 모든 도메인 허용
        resp->addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
        resp->addHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
    });

    // 7. OPTIONS 요청(Preflight) 처리를 위한 간단한 처리
    drogon::app().registerPreRoutingAdvice([](const drogon::HttpRequestPtr &req, drogon::AdviceCallback &&acb, drogon::AdviceChainCallback &&accb) {
        if (req->method() == drogon::Options) {
            auto resp = drogon::HttpResponse::newHttpResponse();
            resp->addHeader("Access-Control-Allow-Origin", "*");
            resp->addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
            resp->addHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
            resp->setStatusCode(drogon::k200OK);
            acb(resp);
            return;
        }
        accb();
    });

    // 8. 휴지통 15일 만료 데이터 자동 영구 삭제(Hard Delete & 물리 파일 삭제) 백그라운드 스케줄러 등록
    //
    // 시작 60초 뒤 한 번, 그 뒤 24시간마다 돈다. runEvery 만 두면 배포로 프로세스를 다시 띄울 때마다
    // 타이머가 처음부터 다시 세어져 하루보다 자주 배포하는 환경에서는 영영 실행되지 않는다.
    //
    // 실제 작업은 워커 스레드에서 돈다 — 동기 DB 호출과 파일 삭제가 들어 있어 IO 스레드에서 돌리면 그 동안
    // 요청이 멈춘다. 동시 실행 수는 worktree 회수와 같이 WorkerLimiter(Normal 차선)로 막는다.
    auto runExpiredCleanup = []() {
        std::thread worker([]() {
            auto &limiter = app_utils::WorkerLimiter::instance();
            if (!limiter.acquire(app_utils::WorkerLimiter::Lane::Normal)) {
                LOG_WARN << "[Scheduler] 15일 만료 정리 건너뜀 — 동시 작업 한도 초과 (running=" << limiter.running()
                         << ", waiting=" << limiter.waiting() << ")";
                return;
            }
            LOG_INFO << "[Scheduler] Starting 15-day expired deleted data cleanup...";
            try {
                purgeExpiredDeletedData();
            } catch (const std::exception &e) {
                LOG_ERROR << "[Scheduler] 15-day expired cleanup failed: " << e.what();
            }
            limiter.release(app_utils::WorkerLimiter::Lane::Normal);
        });
        worker.detach();
    };

    drogon::app().getLoop()->runAfter(60.0, runExpiredCleanup);
    drogon::app().getLoop()->runEvery(86400.0, runExpiredCleanup);

    // 9. PostgreSQL 활동 알림(LISTEN/NOTIFY) 백그라운드 리스너 기동
    api::NotificationWebSocketController::startNotificationListener(dbConnInfo);

    // 10. 브랜치 worktree 회수. 브랜치마다 작업 파일 사본이 통째로 생겨 디스크가 브랜치 수만큼 늘어나므로,
    // 오래 안 쓴 브랜치의 작업 디렉터리를 회수한다. 회수된 브랜치는 다시 열 때 ensureWorktree 가 같은
    // 자리에 되살리므로 사용자에게는 "처음 여는 데 조금 더 걸린다" 정도로만 보인다. git 실행 + 동기 DB 라
    // 워커 스레드에서 돌리고, 동시 실행 수는 다른 무거운 작업과 같이 WorkerLimiter(Normal 차선)로 막는다.
    //
    // 시작 60초 뒤 한 번, 그 뒤 24시간마다 돈다(만료 정리와 같은 이유).
    auto reclaimWorktrees = []() {
        // 설정은 실행 시점의 값을 읽는다(config.json 또는 env 로 바꾼 값이 그대로 쓰인다).
        const auto &custom = drogon::app().getCustomConfig();
        const int idleDays = custom["worktree_idle_days"].asInt();
        const int maxPerRepo = custom["worktree_max_per_repo"].asInt();

        std::thread worker([idleDays, maxPerRepo]() {
            auto &limiter = app_utils::WorkerLimiter::instance();
            if (!limiter.acquire(app_utils::WorkerLimiter::Lane::Normal)) {
                LOG_WARN << "[Scheduler] worktree 회수 건너뜀 — 동시 작업 한도 초과 (running=" << limiter.running()
                         << ", waiting=" << limiter.waiting() << ")";
                return;
            }
            try {
                reclaimIdleWorktrees(idleDays, maxPerRepo);
            } catch (const std::exception &e) {
                LOG_ERROR << "[Scheduler] worktree 회수 실패: " << e.what();
            }
            limiter.release(app_utils::WorkerLimiter::Lane::Normal);
        });
        worker.detach();
    };

    drogon::app().getLoop()->runAfter(60.0, reclaimWorktrees);
    drogon::app().getLoop()->runEvery(86400.0, reclaimWorktrees);

    //Run HTTP framework,the method will block in the internal event loop
    drogon::app().run();
    return 0;
}

