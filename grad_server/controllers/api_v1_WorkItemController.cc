#include "api_v1_WorkItemController.h"
#include "WorkItems.h"
#include <json/json.h>

using namespace api::v1;

// 모델 사용을 위한 네임스페이스
using namespace drogon_model::grad_project;

// Add definition of your processing function here
void WorkItemController::createWorkItem(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback){
    auto jsonPtr = req->getJsonObject();
    Json::Value ret;

    // 1. 유효성 검사
    if(!jsonPtr || (*jsonPtr)["work_item_id"].isNull() || (*jsonPtr)["owner_node_id"].isNull() || (*jsonPtr)["owner_user_id"].isNull() || (*jsonPtr)["title"].isNull()){
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "필수 파라미터(work_item_id, owner_node_id, owner_user_id, title)가 누락되었습니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    // 2. 비지니스 로직
    auto dbClient = drogon::app().getDbClient();
    
    std::string sql = "SELECT create_work_item($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)";
    
    // 필수 파라미터
    std::string work_item_id = (*jsonPtr)["work_item_id"].asString();
    int owner_node_id = (*jsonPtr)["owner_node_id"].asInt();
    std::string owner_user_id = (*jsonPtr)["owner_user_id"].asString();
    std::string title = (*jsonPtr)["title"].asString();

    // 선택 파라미터
    auto getStrOrNull = [&](const std::string &key) {
        return (*jsonPtr)[key].isNull() ? "" : (*jsonPtr)[key].asString();
    };
    auto getIntOrNull = [&](const std::string &key, int defaultVal) {
        return (*jsonPtr)[key].isNull() ? defaultVal : (*jsonPtr)[key].asInt();
    };

    dbClient->execSqlAsync(
        sql,
        [callback](const orm::Result &result) {
            Json::Value successRet;
            successRet["status"] = "success";
            successRet["work_item_id"] = result[0][0].as<std::string>();
            
            auto resp = HttpResponse::newHttpJsonResponse(successRet);
            resp->setStatusCode(k201Created);
            callback(resp);
        },
        [callback](const orm::DrogonDbException &e) {
            Json::Value errorRet;
            errorRet["status"] = "error";
            errorRet["message"] = e.base().what();
            
            auto resp = HttpResponse::newHttpJsonResponse(errorRet);
            resp->setStatusCode(k500InternalServerError);
            callback(resp);
        },
        work_item_id,
        owner_node_id,
        owner_user_id,
        title,
        getStrOrNull("parent_work_item_id"),
        getStrOrNull("description"),
        getStrOrNull("status"),
        getIntOrNull("priority", 3),
        getIntOrNull("weight", 1),
        getIntOrNull("progress", 0),
        getStrOrNull("start_date"),
        getStrOrNull("due_date")
    );
}