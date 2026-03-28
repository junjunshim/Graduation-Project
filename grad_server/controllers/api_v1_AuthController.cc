#include "api_v1_AuthController.h"
#include <json/json.h>
#include <jwt-cpp/jwt.h>
#include <chrono>
#include <iomanip>
#include <sstream>

using namespace api::v1;

// Add definition of your processing function here
Json::Value AuthController::generateToken(const std::string &user_email){
    auto secret = drogon::app().getCustomConfig()["app"]["jwt_secret"].asString();
    auto access_exp = drogon::app().getCustomConfig()["access_token_expiry"].asInt();
    auto refresh_exp = drogon::app().getCustomConfig()["refresh_token_expiry"].asInt();

    auto now = std::chrono::system_clock::now();

    auto access_token = jwt::create()
        .set_issuer("grad_server")
        .set_type("JWS")
        .set_payload_claim("user_email", jwt::claim(user_email))
        .set_issued_at(now)
        .set_expires_at(now + std::chrono::seconds{access_exp})
        .sign(jwt::algorithm::hs256{secret});

    auto refresh_token = jwt::create()
        .set_issuer("grad_server")
        .set_payload_claim("user_email", jwt::claim(user_email))
        .set_issued_at(now)
        .set_expires_at(now + std::chrono::seconds{refresh_exp})
        .sign(jwt::algorithm::hs256{secret});

    Json::Value ret;
    ret["access_token"] = access_token;
    ret["refresh_token"] = refresh_token;
    ret["refresh_token_expiry"] = timePointToString(now + std::chrono::seconds{refresh_exp});
    return ret;
}

std::string AuthController::timePointToString(const std::chrono::system_clock::time_point& tp) {
    std::time_t t = std::chrono::system_clock::to_time_t(tp);
    std::tm tm = *std::localtime(&t); // 또는 gmtime(&t) (UTC 기준 시)
    
    std::stringstream ss;
    ss << std::put_time(&tm, "%Y-%m-%d %H:%M:%S");
    return ss.str();
}

void AuthController::loginUser(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback){
    auto jsonPtr = req->getJsonObject();

    // 1. 유효성 검사
    if(!jsonPtr || (*jsonPtr)["email"].isNull() || (*jsonPtr)["password"].isNull()){
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "필수 파라미터(email, password)가 누락되었습니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    
    // 2. 비즈니스 로직
    auto dbClient = drogon::app().getDbClient();
    
    std::string email = (*jsonPtr)["email"].asString();
    std::string password = (*jsonPtr)["password"].asString();
    
    Json::Value tokens = generateToken(email);

    std::string access_token = tokens["access_token"].asString();
    std::string refresh_token = tokens["refresh_token"].asString();
    std::string refresh_token_expiry = tokens["refresh_token_expiry"].asString();

    std::string sql = "SELECT * from login_user($1, $2, $3, $4::TIMESTAMP)";

    dbClient->execSqlAsync(
        sql,
        [callback, access_token, refresh_token](const orm::Result &result){
            Json::Value ret;
            auto row = result[0];

            bool success = row["status"].as<bool>();

            if(success){
                ret["status"] = "success";
                ret["message"] = row["message"].as<std::string>();
                ret["access_token"] = access_token;
                ret["refresh_token"] = refresh_token;

                auto resp = HttpResponse::newHttpJsonResponse(ret);
                resp->setStatusCode(k200OK);
                callback(resp);
            }
            else{
                ret["status"] = "error";
                ret["message"] = row["message"].as<std::string>();
                
                auto resp = HttpResponse::newHttpJsonResponse(ret);
                resp->setStatusCode(k401Unauthorized);
                callback(resp);
            }
        },
        [callback](const orm::DrogonDbException &e){
            Json::Value ret;
            ret["status"] = "error";
            ret["message"] = e.base().what();
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(k500InternalServerError);
            callback(resp);
        },
        email, password, refresh_token, refresh_token_expiry
    );
}