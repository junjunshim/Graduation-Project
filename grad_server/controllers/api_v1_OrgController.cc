#include "api_v1_OrgController.h"
#include "OrganizationNodes.h"
#include <json/json.h>

using namespace api::v1;

// 모델 사용을 위한 네임스페이스
using namespace drogon_model::grad_project;

// Add definition of your processing function here
void OrgController::createTopNode(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback){
    auto jsonPtr = req->getJsonObject();
    Json::Value ret;
    
    // 1. 유효성 검사
    if(!jsonPtr || (*jsonPtr)["node_type"].isNull() || (*jsonPtr)["name"].isNull() || (*jsonPtr)["user_id"].isNull() || (*jsonPtr)["role_name"].isNull()){
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "필수 파라미터(name, node_type)가 누락되었습니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    // 2. 비지니스 로직
    auto dbClient = drogon::app().getDbClient();
    
    std::string sql = "SELECT create_top_node($1, $2, $3, $4)";

    std::string node_type = (*jsonPtr)["node_type"].asString();
    std::string name = (*jsonPtr)["name"].asString();
    std::string user_id = (*jsonPtr)["user_id"].asString();
    std::string role_name = (*jsonPtr)["role_name"].asString();

    dbClient->execSqlAsync(
        sql,
        [callback](const orm::Result &result) {
            Json::Value ret;
            ret["status"] = "success";
            ret["new_node_id"] = result[0][0].as<int>();
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
        node_type, name, user_id, role_name
    );
}

void OrgController::createSubNode(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback){
    auto jsonPtr = req->getJsonObject();
    Json::Value ret;

    // 1. 유효성 검사
    if(!jsonPtr || (*jsonPtr)["node_type"].isNull() || (*jsonPtr)["parent_node_id"].isNull() || (*jsonPtr)["name"].isNull() || (*jsonPtr)["email"].isNull() || (*jsonPtr)["role_name"].isNull()){
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

    std::string sql = "SELECT create_sub_node($1, $2, $3, $4, $5)";

    std::string node_type = (*jsonPtr)["node_type"].asString();
    int parent_node_id = (*jsonPtr)["parent_node_id"].asInt();
    std::string name = (*jsonPtr)["name"].asString();
    std::string email = (*jsonPtr)["email"].asString();
    std::string role_name = (*jsonPtr)["role_name"].asString();


    dbClient->execSqlAsync(
        sql,
        [callback](const orm::Result &result) {
            Json::Value ret;
            ret["status"] = "success";
            ret["new_node_id"] = result[0][0].as<int>();
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
        node_type, parent_node_id, name, email, role_name
    );
}