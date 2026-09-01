#include "AuthController.h"
#include "ResponseUtils.h"
#include "ValidationUtils.h"
#include <json/json.h>
#include <jwt-cpp/jwt.h>
#include <chrono>
#include <iomanip>
#include <sstream>

using namespace api;
using namespace app_utils;

// Add definition of your processing function here
// 토큰 생성 함수(access token, refresh token)
Json::Value AuthController::generateToken(const std::string &user_email){
    // JWT 토큰 생성을 위한 시크릿 키와 만료 시간 설정
    auto secret = drogon::app().getCustomConfig()["app"]["jwt_secret"].asString();
    auto access_exp = drogon::app().getCustomConfig()["access_token_expiry"].asInt();
    auto refresh_exp = drogon::app().getCustomConfig()["refresh_token_expiry"].asInt();

    // 현재 시간과 만료 시간 계산
    auto now = std::chrono::system_clock::now();

    // Access Token 생성
    auto access_token = jwt::create()
        .set_issuer("grad_server")
        .set_type("JWS")
        .set_payload_claim("user_email", jwt::claim(user_email))
        .set_issued_at(now)
        .set_expires_at(now + std::chrono::seconds{access_exp})
        .sign(jwt::algorithm::hs256{secret});

    // Refresh Token 생성
    auto refresh_token = jwt::create()
        .set_issuer("grad_server")
        .set_payload_claim("user_email", jwt::claim(user_email))
        .set_issued_at(now)
        .set_expires_at(now + std::chrono::seconds{refresh_exp})
        .sign(jwt::algorithm::hs256{secret});

    // 생성된 토큰과 리프레시 토큰 만료 시간을 JSON 객체로 반환
    Json::Value ret;
    ret["access_token"] = access_token;
    ret["refresh_token"] = refresh_token;
    // 리프레시 토큰 만료 시간을 문자열로 변환하여 반환
    ret["refresh_token_expiry"] = timePointToString(now + std::chrono::seconds{refresh_exp});
    return ret;
}

// 시간 포맷 변환 함수
std::string AuthController::timePointToString(const std::chrono::system_clock::time_point& tp) {
    // std::chrono::system_clock::time_point를 std::tm 구조체로 변환
    std::time_t t = std::chrono::system_clock::to_time_t(tp);
    std::tm tm = *std::localtime(&t); // 또는 gmtime(&t) (UTC 기준 시)
    
    // std::tm 구조체를 원하는 문자열 포맷으로 변환
    std::stringstream ss;
    // "YYYY-MM-DD HH:MM:SS"
    ss << std::put_time(&tm, "%Y-%m-%d %H:%M:%S");
    return ss.str();
}

// 로그인 처리 함수
void AuthController::loginUser(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback){
    // 1. 데이터 파싱 및 유효성 검사
    // 필수 파라미터 유효성 검사
    auto jsonPtr = req->getJsonObject();
    if(!validateStrings(jsonPtr, "email", "password")){
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "필수 파라미터(email, password)가 누락되었습니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }
    
    // 요청 바디에서 JSON 데이터 파싱
    std::string email = (*jsonPtr)["email"].asString();
    std::string password = (*jsonPtr)["password"].asString();
    
    
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
            ret["message"] = "로그인 성공";
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

// Access Token 재발급(Refresh) API
void AuthController::refreshUserToken(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    // 1. JSON Request Body에서 refresh_token 추출
    auto jsonPtr = req->getJsonObject();
    if (!validateStrings(jsonPtr, "refresh_token")) {
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "필수 파라미터(refresh_token)가 누락되었습니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    std::string refreshToken = (*jsonPtr)["refresh_token"].asString();

    // 2. JWT 리프레시 토큰 검증
    auto secret = drogon::app().getCustomConfig()["app"]["jwt_secret"].asString();
    std::string user_email;
    try {
        auto verifier = jwt::verify()
            .allow_algorithm(jwt::algorithm::hs256{secret})
            .with_issuer("grad_server");

        auto decoded = jwt::decode(refreshToken);
        verifier.verify(decoded);

        user_email = decoded.get_payload_claim("user_email").as_string();
    } catch (const std::exception &e) {
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "401";
        ret["message"] = "유효하지 않거나 만료된 리프레시 토큰입니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k401Unauthorized);
        callback(resp);
        return;
    }

    // 3. 데이터베이스에서 해당 사용자의 최신 refresh_token과 비교 검증
    auto dbClient = drogon::app().getDbClient();
    std::string sql = "SELECT refresh_token FROM user_refresh_tokens WHERE user_email = $1";

    dbClient->execSqlAsync(
        sql,
        [callback, this, user_email, refreshToken](const orm::Result &result) {
            // DB에 토큰 내역이 없는 경우
            if (result.empty()) {
                Json::Value ret;
                ret["status"] = "error";
                ret["message"] = "등록된 리프레시 토큰을 찾을 수 없습니다. 다시 로그인해 주세요.";
                auto resp = HttpResponse::newHttpJsonResponse(ret);
                resp->setStatusCode(k401Unauthorized);
                callback(resp);
                return;
            }

            auto row = result[0];
            std::string db_token = row["refresh_token"].as<std::string>();

            // 클라이언트 토큰이 DB의 최신 토큰과 불일치할 경우 (도난 방지)
            if (db_token != refreshToken) {
                Json::Value ret;
                ret["status"] = "error";
                ret["message"] = "토큰이 유효하지 않습니다. 다시 로그인해 주세요.";
                auto resp = HttpResponse::newHttpJsonResponse(ret);
                resp->setStatusCode(k401Unauthorized);
                callback(resp);
                return;
            }

            // 4. 검증 성공 시 새로운 Access Token 및 Refresh Token 세트 재생성 (토큰 로테이션)
            Json::Value tokens = generateToken(user_email);
            std::string access_token = tokens["access_token"].asString();
            std::string new_refresh_token = tokens["refresh_token"].asString();
            std::string new_refresh_expiry = tokens["refresh_token_expiry"].asString();

            // 5. DB의 refresh_token 갱신
            auto dbClient = drogon::app().getDbClient();
            std::string updateSql = "INSERT INTO user_refresh_tokens (user_email, refresh_token, expires_at) "
                                    "VALUES ($1, $2, $3::TIMESTAMP) "
                                    "ON CONFLICT (user_email) DO UPDATE SET "
                                    "refresh_token = EXCLUDED.refresh_token, "
                                    "expires_at = EXCLUDED.expires_at";

            dbClient->execSqlAsync(
                updateSql,
                [callback, access_token, new_refresh_token](const orm::Result &uResult) {
                    Json::Value ret;
                    ret["status"] = "success";
                    ret["access_token"] = access_token;
                    ret["refresh_token"] = new_refresh_token;

                    auto resp = HttpResponse::newHttpJsonResponse(ret);
                    resp->setStatusCode(k200OK);
                    callback(resp);
                },
                [callback](const orm::DrogonDbException &e) {
                    Json::Value ret;
                    ret["status"] = "error";
                    ret["message"] = "토큰 정보 업데이트에 실패했습니다.";
                    auto resp = HttpResponse::newHttpJsonResponse(ret);
                    resp->setStatusCode(k500InternalServerError);
                    callback(resp);
                },
                user_email, new_refresh_token, new_refresh_expiry
            );
        },
                [callback](const orm::DrogonDbException &e) {
                    Json::Value ret;
                    ret["status"] = "error";
                    ret["message"] = "토큰 정보 업데이트에 실패했습니다.";
                    auto resp = HttpResponse::newHttpJsonResponse(ret);
                    resp->setStatusCode(k500InternalServerError);
                    callback(resp);
                },
                user_email, new_refresh_token, new_refresh_expiry
            );
        },
        [callback](const orm::DrogonDbException &e) {
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