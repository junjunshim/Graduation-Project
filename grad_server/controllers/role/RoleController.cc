#include "RoleController.h"
#include "RoleAssignments.h"
#include "ResponseUtils.h"
#include "ValidationUtils.h"
#include <json/json.h>

using namespace api;
using namespace app_utils;

// Add definition of your processing function here
// 사용자에게 역할 부여 api
void RoleController::addRole(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback){
    // 1. 데이터 파싱 및 유효성 검사
    // 필수 파라미터 유효성 검사
    auto jsonPtr = req->getJsonObject();
    if(!validateStrings(jsonPtr, "email", "role_name") || !validateInts(jsonPtr, "node_id")){
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "필수 파라미터(email, node_id, role_name)가 누락되었습니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }
    
    // JWT 필터에서 설정한 사용자 이메일을 가져오기
    std::string requester_email = req->attributes()->get<std::string>("user_email");
    
    // 요청 바디에서 JSON 데이터 파싱
    std::string target_email = (*jsonPtr)["email"].asString();
    int node_id = (*jsonPtr)["node_id"].asInt();
    std::string role_name = (*jsonPtr)["role_name"].asString();

    // 2. 비지니스 로직
    //데이터베이스 클라이언트 가져오기
    auto dbClient = drogon::app().getDbClient();
    
    // DB 함수 호출 SQL
    std::string sql = "SELECT * FROM add_role($1, $2, $3, $4)";

    // DB 함수 비동기 실행
    dbClient->execSqlAsync(
        sql,
        // [성공 콜백]
        [callback](const orm::Result &result) {
            // DB 결과를 프론트엔드 응답용 JSON으로 변환
            Json::Value ret = parseIntegratedDataResult(result);
            
            // HTTP 응답 생성 및 반환
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(k201Created);
            callback(resp);
        },
        // [실패 콜백]
        [callback](const orm::DrogonDbException &e) {
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
        // DB 함수에 전달할 매개변수 (요청자 이메일, 대상 이메일, 노드 id, 역할 이름)
        requester_email, target_email, node_id, role_name
    );
}

// 사용자 역할 변경 api
void RoleController::updateRole(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback){
    // 1. 데이터 파싱 및 유효성 검사
    // JWT 필터에서 설정한 사용자 이메일을 가져오기
    std::string requester_email = req->attributes()->get<std::string>("user_email");
    
    // 요청 바디에서 JSON 데이터 파싱
    auto jsonPtr = req->getJsonObject();
    
    // 필수 파라미터 유효성 검사
    if(!jsonPtr || !validateStrings(jsonPtr, "email", "role_name") || !validateInts(jsonPtr, "node_id")){
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "필수 파라미터(email, node_id, role_name)가 누락되었습니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    std::string target_email = (*jsonPtr)["email"].asString();
    int node_id = (*jsonPtr)["node_id"].asInt();
    std::string role_name = (*jsonPtr)["role_name"].asString();
    
    // 2. 비지니스 로직
    // 데이터베이스 클라이언트 객체를 가져오기
    auto dbClient = drogon::app().getDbClient();
    
    // DB 함수 호출 SQL
    std::string sql = "SELECT * FROM update_role($1, $2, $3, $4)";
    
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
        [callback](const orm::DrogonDbException &e) {
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
        // DB 함수에 전달할 매개변수 (요청자 이메일, 대상 이메일, 노드 id, 역할 이름)
        requester_email, 
        target_email, 
        node_id, 
        role_name
    );
}

// 노드별 신규 역할 생성 api
void RoleController::createRoleDefinition(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback){
    // 1. 데이터 파싱 및 유효성 검사
    auto jsonPtr = req->getJsonObject();
    if(!validateStrings(jsonPtr, "role_name", "authority") || !validateInts(jsonPtr, "node_id")){
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "필수 파라미터(node_id, role_name, authority)가 누락되었습니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    std::string requester_email = req->attributes()->get<std::string>("user_email");
    int node_id = (*jsonPtr)["node_id"].asInt();
    std::string role_name = (*jsonPtr)["role_name"].asString();
    std::string authority = (*jsonPtr)["authority"].asString();

    if (authority.length() != 24) {
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "authority는 24비트 2진수 문자열이어야 합니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    // 2. 비즈니스 로직 실행
    auto dbClient = drogon::app().getDbClient();
    std::string sql = "SELECT * FROM create_role_definition($1, $2, $3, $4)";

    dbClient->execSqlAsync(
        sql,
        [callback](const orm::Result &result) {
            Json::Value ret = parseIntegratedDataResult(result);
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(k201Created);
            callback(resp);
        },
        [callback](const orm::DrogonDbException &e) {
            Json::Value ret = parseDbError(e);
            auto statusCode = static_cast<drogon::HttpStatusCode>(ret["http_code"].asInt());
            ret.removeMember("http_code");

            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(statusCode);
            callback(resp);
        },
        requester_email, node_id, role_name, authority
    );
}

// 노드별 역할 권한 수정 api
void RoleController::updateRoleAuthority(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback){
    // 1. 데이터 파싱 및 유효성 검사
    auto jsonPtr = req->getJsonObject();
    if(!validateStrings(jsonPtr, "role_name", "authority") || !validateInts(jsonPtr, "node_id")){
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "필수 파라미터(node_id, role_name, authority)가 누락되었습니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    std::string requester_email = req->attributes()->get<std::string>("user_email");
    int node_id = (*jsonPtr)["node_id"].asInt();
    std::string role_name = (*jsonPtr)["role_name"].asString();
    std::string authority = (*jsonPtr)["authority"].asString();

    if (authority.length() != 24) {
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "authority는 24비트 2진수 문자열이어야 합니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    // 2. 비즈니스 로직 실행
    auto dbClient = drogon::app().getDbClient();
    std::string sql = "SELECT * FROM update_role_authority($1, $2, $3, $4)";

    dbClient->execSqlAsync(
        sql,
        [callback](const orm::Result &result) {
            Json::Value ret = parseIntegratedDataResult(result);
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(k200OK);
            callback(resp);
        },
        [callback](const orm::DrogonDbException &e) {
            Json::Value ret = parseDbError(e);
            auto statusCode = static_cast<drogon::HttpStatusCode>(ret["http_code"].asInt());
            ret.removeMember("http_code");

            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(statusCode);
            callback(resp);
        },
        requester_email, node_id, role_name, authority
    );
}