#include "UserController.h"
#include "AuthInputUtils.h"
#include "LogContext.h"
#include "ResponseUtils.h"
#include "SecureToken.h"
#include "ValidationUtils.h"
#include "Users.h"
#include <json/json.h>

using namespace api;
using namespace app_utils;

// 모델 사용을 위한 네임스페이스
using namespace drogon_model::grad_project;

// 이메일 인증을 마친 사용자만 가입할 수 있다.
void UserController::createUser(const HttpRequestPtr &req,
                                std::function<void(const HttpResponsePtr &)> &&callback) {
    const auto jsonPtr = req->getJsonObject();
    if (!validateStrings(jsonPtr, "user_id", "email", "name", "password", "verification_token")) {
        Json::Value ret;
        ret["status"] = "error";
        ret["message"] = "필수 가입 정보가 누락되었습니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    const std::string user_id = trimAuthInput((*jsonPtr)["user_id"].asString());
    const std::string email = normalizeAuthEmail((*jsonPtr)["email"].asString());
    const std::string name = trimAuthInput((*jsonPtr)["name"].asString());
    const std::string password = (*jsonPtr)["password"].asString();
    const std::string verificationToken = trimAuthInput((*jsonPtr)["verification_token"].asString());

    auto sendError = [&callback](const std::string &message, HttpStatusCode status) {
        Json::Value ret;
        ret["status"] = "error";
        ret["message"] = message;
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(status);
        callback(resp);
    };

    if (!isValidSignupUserId(user_id)) {
        sendError("아이디는 4~30자의 영문, 숫자, 하이픈(-), 언더바(_)만 사용할 수 있으며 영문이나 숫자로 시작해야 합니다.",
                  k400BadRequest);
        return;
    }
    if (!isValidAuthEmail(email)) {
        sendError("올바른 이메일 형식을 입력해 주세요.", k400BadRequest);
        return;
    }
    if (!isValidSignupDisplayName(name)) {
        sendError("닉네임은 1~50자까지 입력할 수 있습니다.", k400BadRequest);
        return;
    }
    if (!isValidSignupPassword(password)) {
        sendError("비밀번호는 8~64자이며 영문, 숫자, 특수문자를 모두 포함해야 합니다.", k400BadRequest);
        return;
    }
    if (!isSha256Hex(verificationToken)) {
        sendError("이메일 인증이 유효하지 않거나 만료되었습니다. 인증을 다시 진행해 주세요.", k400BadRequest);
        return;
    }

    const std::string tokenHash = sha256Hex(verificationToken);
    if (!isSha256Hex(tokenHash)) {
        sendError("이메일 인증을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.", k500InternalServerError);
        return;
    }

    auto dbClient = drogon::app().getDbClient();
    dbClient->execSqlAsync(
        "SELECT register_user_verified($1, $2, $3, $4, $5)",
        [callback, req, email](const orm::Result &result) {
            if (result.empty() || !result[0][0].as<bool>()) {
                Json::Value ret;
                ret["status"] = "error";
                ret["message"] = "회원가입에 실패했습니다.";
                auto resp = HttpResponse::newHttpJsonResponse(ret);
                resp->setStatusCode(k500InternalServerError);
                callback(resp);
                return;
            }

            LOG_INFO << "[Signup] event=user.created " << requestIdTag(requestIdOf(req))
                     << " recipient=" << maskEmail(email);
            Json::Value ret;
            ret["status"] = "success";
            ret["message"] = "회원가입이 완료되었습니다.";
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(k201Created);
            callback(resp);
        },
        [callback, req](const orm::DrogonDbException &e) {
            Json::Value ret = parseDbError(e, app_utils::requestIdOf(req));
            const auto statusCode = static_cast<drogon::HttpStatusCode>(ret["http_code"].asInt());
            ret.removeMember("http_code");

            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(statusCode);
            callback(resp);
        },
        tokenHash, user_id, email, name, password);
}

// user 프로필 조회 API
void UserController::getUser(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback){
    // 1. 데이터 파싱 및 유효성 검사
    // 쿼리 파라미터에서 target_email 가져오기
    std::string target_email = req->getParameter("target_email");
    if(target_email.empty()){
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "필수 파라미터(target_email)가 누락되었습니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    // JWT 필터에서 설정한 사용자 이메일을 가져오기
    std::string requester_email = req->attributes()->get<std::string>("user_email");

    // 2. 비지니스 로직
    // 데이터베이스 클라이언트 객체를 가져오기
    auto dbClient = drogon::app().getDbClient();

    // DB 함수 호출 SQL
    std::string sql = "SELECT * from get_user_profile($1, $2)";

    // DB 함수 비동기 실행
    dbClient->execSqlAsync(
        sql,
        // [성공 콜백]
        [callback](const orm::Result &result) {
            // DB 결과를 프론트엔드 응답용 JSON으로 변환
            Json::Value ret = parseIntegratedDataResult(result);

            // HTTP 응답 생성 및 반환
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(k200OK);
            callback(resp);
        },
        // [실패 콜백]
        [callback, req](const orm::DrogonDbException &e) {
            // DB 에러를 파싱하여 프론트엔드 응답용 JSON으로 변환
            Json::Value ret = parseDbError(e, app_utils::requestIdOf(req));

            // HTTP 상태 코드 추출
            auto statusCode = static_cast<drogon::HttpStatusCode>(ret["http_code"].asInt());

            // JSON 응답에서 http_code 필드를 제거
            ret.removeMember("http_code");

            // HTTP 응답 생성 및 반환
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(statusCode);
            callback(resp);
        },
        // DB 함수에 전달할 매개변수 (요청자 이메일, 대상 이메일)
        requester_email, target_email
    );
}

// user 정보 수정 API
void UserController::updateUser(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback){
    // 1. 데이터 파싱 및 유효성 검사
    // 필수 파라미터 유효성 검사
    auto jsonPtr = req->getJsonObject();
    if(!validateStrings(jsonPtr, "target_email")){
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "필수 파라미터(target_email)가 누락되었습니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    // JWT 필터에서 설정한 사용자 이메일을 가져오기
    std::string requester_email = req->attributes()->get<std::string>("user_email");

    // 필수 파라미터
    std::string target_email = (*jsonPtr)["target_email"].asString();

    // 선택 파라미터
    auto getStrOrNull = [&](const std::string &key) {
        return (*jsonPtr)[key].isNull() ? "" : (*jsonPtr)[key].asString();
    };

    // 2. 비지니스 로직
    // 데이터베이스 클라이언트 객체를 가져오기
    auto dbClient = drogon::app().getDbClient();

    // DB 함수 호출 SQL
    std::string sql = "SELECT * from update_user($1, $2, $3, $4)";

    // DB 함수 비동기 실행
    dbClient->execSqlAsync(
        sql,
        // [성공 콜백]
        [callback](const orm::Result &result) {
            // DB 결과를 프론트엔드 응답용 JSON으로 변환
            Json::Value ret = parseIntegratedDataResult(result);

            // HTTP 응답 생성 및 반환
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(k200OK);
            callback(resp);
        },
        // [실패 콜백]
        [callback, req](const orm::DrogonDbException &e) {
            // DB 에러를 파싱하여 프론트엔드 응답용 JSON으로 변환
            Json::Value ret = parseDbError(e, app_utils::requestIdOf(req));

            // HTTP 상태 코드 추출
            auto statusCode = static_cast<drogon::HttpStatusCode>(ret["http_code"].asInt());

            // JSON 응답에서 http_code 필드를 제거
            ret.removeMember("http_code");

            // HTTP 응답 생성 및 반환
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(statusCode);
            callback(resp);
        },
        // DB 함수에 전달할 매개변수 (요청자 이메일, 대상 이메일, 이름, 패스워드)
        requester_email, target_email, getStrOrNull("name"), getStrOrNull("password")
    );
}

// user 삭제(탈퇴) API
void UserController::deleteUser(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback){
    // 1. 데이터 파싱 및 유효성 검사
    // 필수 파라미터 유효성 검사
    auto jsonPtr = req->getJsonObject();
    if(!validateStrings(jsonPtr, "target_email")){
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "필수 파라미터(target_email)가 누락되었습니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    // JWT 필터에서 설정한 사용자 이메일을 가져오기
    std::string requester_email = req->attributes()->get<std::string>("user_email");

    // 필수 파라미터
    std::string target_email = (*jsonPtr)["target_email"].asString();

    // 2. 비지니스 로직
    // 데이터베이스 클라이언트 객체를 가져오기
    auto dbClient = drogon::app().getDbClient();

    // DB 함수 호출 SQL (성공 시 BOOLEAN true 반환)
    std::string sql = "SELECT delete_user($1, $2)";

    // DB 함수 비동기 실행
    dbClient->execSqlAsync(
        sql,
        // [성공 콜백]
        [callback](const orm::Result &result) {
            // DB 결과 검사
            if(result.empty() || !result[0][0].as<bool>()){
                Json::Value ret;
                ret["status"] = "error";
                ret["message"] = "User deletion failed.";
                auto resp = HttpResponse::newHttpJsonResponse(ret);
                resp->setStatusCode(k500InternalServerError);
                callback(resp);
                return;
            }
            // 성공 응답 생성 및 반환
            Json::Value ret;
            ret["status"] = "success";
            ret["message"] = "User deleted successfully";
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(k200OK);
            callback(resp);
        },
        // [실패 콜백]
        [callback, req](const orm::DrogonDbException &e) {
            // DB 에러를 파싱하여 프론트엔드 응답용 JSON으로 변환
            Json::Value ret = parseDbError(e, app_utils::requestIdOf(req));

            // HTTP 상태 코드 추출
            auto statusCode = static_cast<drogon::HttpStatusCode>(ret["http_code"].asInt());

            // JSON 응답에서 http_code 필드를 제거
            ret.removeMember("http_code");

            // HTTP 응답 생성 및 반환
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(statusCode);
            callback(resp);
        },
        // DB 함수에 전달할 매개변수 (요청자 이메일, 대상 이메일)
        requester_email, target_email
    );
}

// 멘션 알림 읽음 처리 API
void UserController::readNotification(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback) {
    // 1. 필수 파라미터 확인 및 유효성 검사
    auto jsonPtr = req->getJsonObject();
    if(!jsonPtr || (*jsonPtr)["mention_id"].isNull()){
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "필수 파라미터(mention_id)가 누락되었습니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    std::string requester_email = req->attributes()->get<std::string>("user_email");
    int mention_id = (*jsonPtr)["mention_id"].asInt();

    // 2. 비즈니스 로직 실행
    auto dbClient = drogon::app().getDbClient();
    std::string sql = "SELECT * FROM read_comment_mention($1, $2)";

    dbClient->execSqlAsync(
        sql,
        // [성공 콜백]
        [callback](const orm::Result &result) {
            Json::Value ret = parseIntegratedDataResult(result);
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(k200OK);
            callback(resp);
        },
        // [실패 콜백]
        [callback, req](const orm::DrogonDbException &e) {
            Json::Value ret = parseDbError(e, app_utils::requestIdOf(req));
            auto statusCode = static_cast<drogon::HttpStatusCode>(ret["http_code"].asInt());
            ret.removeMember("http_code");

            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(statusCode);
            callback(resp);
        },
        requester_email, mention_id
    );
}   
