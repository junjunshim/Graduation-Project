#include "AuthController.h"
#include "ResponseUtils.h"
#include <json/json.h>
#include <jwt-cpp/jwt.h>
#include <chrono>
#include <iomanip>
#include <sstream>

using namespace api;
using namespace app_utils;

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
    // 1. 데이터 파싱 및 유효성 검사
    // 요청 바디에서 JSON 데이터 파싱
    auto jsonPtr = req->getJsonObject();
    std::string email = (*jsonPtr)["email"].asString();
    std::string password = (*jsonPtr)["password"].asString();
    
    // 필수 파라미터 유효성 검사
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
    // 데이터베이스 클라이언트 객체를 가져오기
    auto dbClient = drogon::app().getDbClient();
    
    // JWT 토큰 생성
    Json::Value tokens = generateToken(email);

    // JWT 토큰에서 필요한 정보 추출
    std::string access_token = tokens["access_token"].asString();
    std::string refresh_token = tokens["refresh_token"].asString();
    std::string refresh_token_expiry = tokens["refresh_token_expiry"].asString();

    // DB 함수 호출 SQL
    std::string sql = "SELECT * from login_user($1, $2, $3, $4::TIMESTAMP)";

    // DB 함수 비동기 실행
    dbClient->execSqlAsync(
        sql,
        // [성공 콜백]
        [callback, access_token, refresh_token](const orm::Result &result){
            // DB 결과 검사
            if(result.empty() || !result[0][0].as<bool>()){
                // 실패 응답 생성 및 반환
                Json::Value ret;
                ret["status"] = "error";
                ret["message"] = "Invalid email or password.";
                auto resp = HttpResponse::newHttpJsonResponse(ret);
                resp->setStatusCode(k401Unauthorized);
                callback(resp);
                return;
            }
            // 성공 응답 생성 및 반환
            Json::Value ret;
            ret["status"] = "success";
            ret["access_token"] = access_token;
            ret["refresh_token"] = refresh_token;
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(k200OK);
            callback(resp);
        },
        // [실패 콜백]
        [callback](const orm::DrogonDbException &e){
            // DB 에러를 파싱하여 프론트엔드 응답용 JSON으로 변환
            Json::Value ret = parseDbError(e);

            // HTTP 상태 코드 추출
            auto statusCode = static_cast<drogon::HttpStatusCode>(ret["http_code"].asInt());

            // JSON 응답에서 http_code 필드를 제거
            ret.removeMember("http_code");

            // HTTP 응답 생성 및 반환
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(statusCode);
            callback(resp);
        },
        // DB 함수에 전달할 매개변수 (이메일, 비밀번호, 리프레시 토큰, 리프레시 토큰 만료 시간)
        email, password, refresh_token, refresh_token_expiry
    );
}