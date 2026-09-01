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
    
    // role_name 유효성 검사
    if(role_name != "ADMIN" && role_name != "MANAGER" && role_name != "MEMBER" && role_name != "VIEWER"){
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "유효하지 않은 role_name입니다. (허용값: ADMIN, MANAGER, MEMBER, VIEWER)";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

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
    
    // 필수 파라미터
    std::string target_email = (*jsonPtr)["email"].asString();
    int node_id = (*jsonPtr)["node_id"].asInt();

    // 선택 파라미터
    auto getStrOrNull = [&](const std::string &key) {
        return (*jsonPtr)[key].isNull() ? "" : (*jsonPtr)[key].asString();
    };
    
    // 필수 파라미터 유효성 검사
    if(!jsonPtr || (*jsonPtr)["email"].isNull() || (*jsonPtr)["node_id"].isNull()){
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "필수 파라미터(email, node_id)가 누락되었습니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }
    
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
        getStrOrNull("role_name")
    );
}