#include "api_v1_ContextController.h"
#include <json/json.h>

using namespace api::v1;

// Add definition of your processing function here
void ContextController::getInitialContext(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback){
    // 1. 유효성 검사

    // 2. 비지니스 로직
    auto dbClient = drogon::app().getDbClient();

    std::string user_email = req->attributes()->get<std::string>("user_email");

    std::string sql = "SELECT * FROM get_initial_context($1)";

    dbClient->execSqlAsync(
        sql,
        [callback](const orm::Result &result){
            Json::Value ret;
            Json::Value items(Json::arrayValue);

            for(auto const &row : result){
                Json::Value item;

                item["type"] = row["out_type"].as<std::string>();
                item["id"] = row["out_id"].as<std::string>();

                if(!row["out_node_type"].isNull() && !row["out_node_type"].as<std::string>().empty()){
                    item["node_type"] = row["out_node_type"].as<std::string>();
                }

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

                item["updated_at"] = row["out_updated_at"].as<std::string>();

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
        user_email
    );
}

void ContextController::syncContext(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback){
    // 1. 유효성 검사
    auto user_email = req->attributes()->get<std::string>("user_email");
    std::string last_synced_at = req->getParameter("last_synced_at");
    
    if (last_synced_at.empty()) {
        last_synced_at = "1970-01-01 00:00:00";
    }

    // 2. 비지니스 로직
    auto dbClient = drogon::app().getDbClient();

    std::string sql = "SELECT * FROM sync_context($1, $2)";

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

                item["updated_at"] = row["out_updated_at"].as<std::string>();

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
        user_email, last_synced_at
    );
}