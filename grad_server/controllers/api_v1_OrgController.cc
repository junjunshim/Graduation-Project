#include "api_v1_OrgController.h"
#include "OrganizationNodes.h"
#include <json/json.h>

using namespace api::v1;

// 모델 사용을 위한 네임스페이스
using namespace drogon_model::grad_project;

// Add definition of your processing function here
void OrgController::createTopNode(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback){
    auto jsonPtr = req->getJsonObject();
    
    // 1. 유효성 검사
    if(!jsonPtr || (*jsonPtr)["node_type"].isNull() || (*jsonPtr)["name"].isNull() || (*jsonPtr)["role_name"].isNull()){
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "필수 파라미터(name, node_type, role_name)가 누락되었습니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    // 2. 비지니스 로직
    auto dbClient = drogon::app().getDbClient();
    
    std::string sql = "SELECT * FROM create_top_node($1, $2, $3, $4)";

    std::string user_email = req->attributes()->get<std::string>("user_email");
    std::string node_type = (*jsonPtr)["node_type"].asString();
    std::string name = (*jsonPtr)["name"].asString();
    std::string role_name = (*jsonPtr)["role_name"].asString();

    dbClient->execSqlAsync(
        sql,
        [callback](const orm::Result &result) {
            if (result.empty()) {
                Json::Value ret;
                ret["status"] = "error";
                ret["message"] = "노드 생성에 실패했습니다.";
                auto resp = HttpResponse::newHttpJsonResponse(ret);
                resp->setStatusCode(k500InternalServerError);
                callback(resp);
                return;
            }
            Json::Value ret;
            Json::Value item;

            auto row = result[0];

            item["type"] = row["out_type"].as<std::string>();
            item["id"] = row["out_id"].as<std::string>();
            item["node_type"] = row["out_node_type"].as<std::string>();
            item["title"] = row["out_title"].as<std::string>();
            item["extra_info"] = row["out_extra_info"].as<std::string>();
            item["updated_at"] = row["out_updated_at"].as<std::string>();

            ret["status"] = "success";
            ret["data"] = item;
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(k201Created);
            callback(resp);
        },
        [callback](const orm::DrogonDbException &e) {
            Json::Value ret;
            ret["status"] = "error";
            ret["message"] = e.base().what();
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(k500InternalServerError);
            callback(resp);
        },
        user_email, node_type, name, role_name
    );
}

void OrgController::createSubNode(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback){
    auto jsonPtr = req->getJsonObject();

    // 1. 유효성 검사
    if(!jsonPtr || (*jsonPtr)["node_type"].isNull() || (*jsonPtr)["parent_node_id"].isNull() || (*jsonPtr)["name"].isNull() || (*jsonPtr)["email"].isNull() || (*jsonPtr)["role_name"].isNull()){
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "필수 파라미터(node_type, parent_node_id, name, email, role_name)가 누락되었습니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    // 2. 비지니스 로직
    auto dbClient = drogon::app().getDbClient();

    std::string sql = "SELECT * FROM create_sub_node($1, $2, $3, $4, $5, $6)";

    std::string requester_email = req->attributes()->get<std::string>("user_email");
    std::string node_type = (*jsonPtr)["node_type"].asString();
    int parent_node_id = (*jsonPtr)["parent_node_id"].asInt();
    std::string name = (*jsonPtr)["name"].asString();
    std::string owner_user_email = (*jsonPtr)["email"].asString();
    std::string role_name = (*jsonPtr)["role_name"].asString();


    dbClient->execSqlAsync(
        sql,
        [callback](const orm::Result &result) {
            if (result.empty()) {
                Json::Value ret;
                ret["status"] = "error";
                ret["message"] = "노드 생성에 실패했습니다.";
                auto resp = HttpResponse::newHttpJsonResponse(ret);
                resp->setStatusCode(k500InternalServerError);
                callback(resp);
                return;
            }
            Json::Value ret;
            Json::Value item;

            auto row = result[0];

            bool success = row["out_res_status"].as<bool>();

            if(success){
                ret["status"] = "success";
                ret["message"] = row["out_message"].as<std::string>();

                item["type"] = row["out_type"].as<std::string>();
                item["id"] = row["out_id"].as<std::string>();
                item["node_type"] = row["out_node_type"].as<std::string>();
                item["parent_id"] = row["out_parent_id"].as<std::string>();
                item["title"] = row["out_title"].as<std::string>();
                item["extra_info"] = row["out_extra_info"].as<std::string>();
                item["updated_at"] = row["out_updated_at"].as<std::string>();

                ret["data"] = item;
                auto resp = HttpResponse::newHttpJsonResponse(ret);
                resp->setStatusCode(k201Created);
                callback(resp);
            }
            else{
                ret["status"] = "error";
                ret["message"] = row["out_message"].as<std::string>();
                auto resp = HttpResponse::newHttpJsonResponse(ret);
                resp->setStatusCode(k403Forbidden);
                callback(resp);
            }
        },
        [callback](const orm::DrogonDbException &e) {
            Json::Value ret;
            ret["status"] = "error";
            ret["message"] = e.base().what();
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(k500InternalServerError);
            callback(resp);
        },
        requester_email, node_type, parent_node_id, name, owner_user_email, role_name
    );
}