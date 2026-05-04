#include "UserController.h"
#include "Users.h"
#include <json/json.h>

using namespace api;

// 모델 사용을 위한 네임스페이스
using namespace drogon_model::grad_project;

// Add definition of your processing function here
void UserController::createUser(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback){
    auto jsonPtr = req->getJsonObject();

    // 1. 유효성 검사
    if(!jsonPtr || (*jsonPtr)["user_id"].isNull() || (*jsonPtr)["email"].isNull() || (*jsonPtr)["name"].isNull() || (*jsonPtr)["password"].isNull()){
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "필수 파라미터(user_id, email, name, password)가 누락되었습니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    // 2. 비지니스 로직
    auto dbClient = drogon::app().getDbClient();

    std::string sql = "SELECT register_user($1, $2, $3, $4)";

    std::string user_id = (*jsonPtr)["user_id"].asString();
    std::string email = (*jsonPtr)["email"].asString();
    std::string name = (*jsonPtr)["name"].asString();
    std::string password_hash = (*jsonPtr)["password"].asString();

    dbClient->execSqlAsync(
        sql,
        [callback](const orm::Result &result) {
            Json::Value ret;
            ret["status"] = "success";
            ret["message"] = "User registered successfully";
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(k200OK);
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
        user_id, email, name, password_hash
    );
}