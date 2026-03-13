#include "api_v1_RoleController.h"
#include "RoleAssignments.h"
#include <json/json.h>

using namespace api::v1;

// Add definition of your processing function here
void RoleController::addRole(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback){
    auto jsonPtr = req->getJsonObject();
    Json::Value ret;

    // 1. 유효성 검사
    if(!jsonPtr || (*jsonPtr)["email"].isNull() || (*jsonPtr)["node_id"].isNull() || (*jsonPtr)["role_name"].isNull()){
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "필수 파라미터(email, node_id, role_name)가 누락되었습니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    // 2. 비지니스 로직
    auto dbClient = drogon::app().getDbClient();
    
    std::string sql = "SELECT add_role($1, $2, $3)";

    std::string email = (*jsonPtr)["email"].asString();
    int node_id = (*jsonPtr)["node_id"].asInt();
    std::string role_name = (*jsonPtr)["role_name"].asString();

    dbClient->execSqlAsync(
        sql,
        [callback](const orm::Result &result) {
            Json::Value ret;
            ret["status"] = "success";
            ret["new_role_id"] = result[0][0].as<int>();
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
        email, node_id, role_name
    );
}