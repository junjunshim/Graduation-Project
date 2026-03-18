#include "api_v1_ContextController.h"
#include <json/json.h>

using namespace api::v1;

// Add definition of your processing function here
void ContextController::getInitialContext(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback){
    auto jsonPtr = req->getJsonObject();
    Json::Value ret;

    // 1. 유효성 검사
    if(!jsonPtr || (*jsonPtr)["user_id"].isNull()){
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "필수 파라미터(user_id)가 누락되었습니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    // 2. 비지니스 로직
    auto dbClient = drogon::app().getDbClient();

    std::string sql = "SELECT * FROM get_initial_context($1)";

    std::string user_id = (*jsonPtr)["user_id"].asString();

    dbClient->execSqlAsync(
        sql,
        [callback](const orm::Result &result){
            Json::Value ret;
            Json::Value items(Json::arrayValue);

            for(auto const &row : result){
                Json::Value item;

                item["type"] = row["out_type"].as<std::string>();
                item["id"] = row["out_id"].as<std::string>();

                if(!row["out_parent_id"].isNull() && !row["out_parent_id"].as<std::string>().empty()){
                    item["parent_id"] = row["out_parent_id"].as<std::string>();
                }

                item["title"] = row["out_title"].as<std::string>();

                if(item["type"].asString() == "WORK_ITEM"){
                    item["status"] = row["out_status"].as<std::string>();
                    item["priority"] = row["out_priority"].as<int>();
                }

                if (!row["out_extra_info"].isNull()) {
                    item["extra_info"] = row["out_extra_info"].as<std::string>();
                }

                items.append(item);
            }

            ret["status"] = "success";
            ret["data"] = items;

            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(k200OK);
            callback(resp);
        },
        [callback](const orm::DrogonDbException &e){
            Json::Value ret;
            ret["status"] = "error";
            ret["message"] = e.base().what();
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(k500InternalServerError);
            callback(resp);
        },
        user_id
    );
}