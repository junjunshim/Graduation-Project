#include "OrgController.h"
#include "OrganizationNodes.h"
#include "ResponseUtils.h"
#include <json/json.h>

using namespace api;
using namespace app_utils;

// 모델 사용을 위한 네임스페이스
using namespace drogon_model::grad_project;

// Add definition of your processing function here

// 최상위 노드 생성 api
void OrgController::createTopNode(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback){
    // 1. 데이터 파싱 및 유효성 검사
    // JWT 필터에서 설정한 사용자 이메일을 가져오기
    std::string user_email = req->attributes()->get<std::string>("user_email");
    
    // 요청 바디에서 JSON 데이터 파싱
    auto jsonPtr = req->getJsonObject();
    std::string node_type = (*jsonPtr)["node_type"].asString();
    std::string name = (*jsonPtr)["name"].asString();

    // 필수 파라미터 유효성 검사
    if(!jsonPtr || (*jsonPtr)["node_type"].isNull() || (*jsonPtr)["name"].isNull()){
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "필수 파라미터(name, node_type)가 누락되었습니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    // 2. 비지니스 로직
    // 데이터베이스 클라이언트 객체를 가져오기
    auto dbClient = drogon::app().getDbClient();
    
    // DB 함수 호출 SQL
    std::string sql = "SELECT * FROM create_top_node($1, $2, $3)";

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
        // DB 함수에 전달할 매개변수 (사용자 이메일, 노드 타입, 노드 이름, 생성자 권한)
        user_email, node_type, name
    );
}

// 하위 노드 생성 api
void OrgController::createSubNode(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback){
    // 1. 데이터 파싱 및 유효성 검사
    // JWT 필터에서 설정한 사용자 이메일을 가져오기
    std::string requester_email = req->attributes()->get<std::string>("user_email");
    
    // 요청 바디에서 JSON 데이터 파싱
    auto jsonPtr = req->getJsonObject();
    std::string node_type = (*jsonPtr)["node_type"].asString();
    std::string name = (*jsonPtr)["name"].asString();
    std::string owner_user_email = (*jsonPtr)["email"].asString();
    int parent_node_id = (*jsonPtr)["parent_node_id"].asInt();

    // 필수 파라미터 유효성 검사
    if(!jsonPtr || (*jsonPtr)["node_type"].isNull() || (*jsonPtr)["parent_node_id"].isNull() || (*jsonPtr)["name"].isNull() || (*jsonPtr)["email"].isNull()){
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "필수 파라미터(node_type, parent_node_id, name, email)가 누락되었습니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    // 2. 비지니스 로직
    // 데이터베이스 클라이언트 객체를 가져오기
    auto dbClient = drogon::app().getDbClient();

    // DB 함수 호출 SQL
    std::string sql = "SELECT * FROM create_sub_node($1, $2, $3, $4, $5)";

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
        // DB 함수에 전달할 매개변수 (요청자 이메일, 노드 타입, 부모 노드 id, 노드 이름, 소유자 이메일)
        requester_email, node_type, parent_node_id, name, owner_user_email
    );
}

// 노드 업데이트 api
void OrgController::updateNode(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback){
    // 1. 데이터 파싱 및 유효성 검사
    // JWT 필터에서 설정한 사용자 이메일을 가져오기
    std::string requester_email = req->attributes()->get<std::string>("user_email");
    
    // 요청 바디에서 JSON 데이터 파싱
    auto jsonPtr = req->getJsonObject();
    
    // 필수 파라미터
    int node_id = (*jsonPtr)["node_id"].asInt();
    
    // 선택 파라미터
    auto getStrOrNull = [&](const std::string &key) {
        return (*jsonPtr)[key].isNull() ? "" : (*jsonPtr)[key].asString();
    };
    
    // 필수 파라미터 유효성 검사
    if(!jsonPtr || (*jsonPtr)["node_id"].isNull()){
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "필수 파라미터(node_id)가 누락되었습니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    // 2. 비지니스 로직
    // 데이터베이스 클라이언트 객체를 가져오기
    auto dbClient = drogon::app().getDbClient();
    
    // DB 함수 호출 SQL
    std::string sql = "SELECT * FROM update_node($1, $2, $3,$4)";

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
        // DB 함수에 전달할 매개변수 (요청자 이메일, 노드 id, 노드 이름, 노드 타입)
        requester_email, 
        node_id, 
        getStrOrNull("name"), 
        getStrOrNull("node_type")
    );
}

