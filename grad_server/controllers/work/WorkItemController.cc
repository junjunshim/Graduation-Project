#include "WorkItemController.h"
#include "ResponseUtils.h"
#include "ValidationUtils.h"
#include "WorkItems.h"
#include <json/json.h>
#include <optional>

using namespace api;
using namespace app_utils;

// 모델 사용을 위한 네임스페이스
using namespace drogon_model::grad_project;

// Add definition of your processing function here
// work item 생성 API
void WorkItemController::createWorkItem(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback){
    // 1. 데이터 파싱 및 유효성 검사
    // 필수 파라미터 유효성 검사
    auto jsonPtr = req->getJsonObject();
    if(!validateStrings(jsonPtr, "work_item_id", "owner_user_email", "title") || !validateInts(jsonPtr, "owner_node_id")){
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "필수 파라미터(work_item_id, owner_node_id, owner_user_email, title)가 누락되었습니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    // JWT 필터에서 설정한 사용자 이메일을 가져오기
    std::string requester_email = req->attributes()->get<std::string>("user_email");

    // 필수 파라미터 
    std::string work_item_id = (*jsonPtr)["work_item_id"].asString();
    int owner_node_id = (*jsonPtr)["owner_node_id"].asInt();
    std::string owner_user_email = (*jsonPtr)["owner_user_email"].asString();
    std::string title = (*jsonPtr)["title"].asString();

    // 선택 파라미터
    auto getStrOrNull = [&](const std::string &key) {
        return (*jsonPtr)[key].isNull() ? "" : (*jsonPtr)[key].asString();
    };
    auto getIntOrNull = [&](const std::string &key, int defaultVal) {
        return (*jsonPtr)[key].isNull() ? defaultVal : (*jsonPtr)[key].asInt();
    };
    auto getBoolOrNull = [&](const std::string &key, bool defaultVal) {
        return (*jsonPtr)[key].isNull() ? defaultVal : (*jsonPtr)[key].asBool();
    };


    // 2. 비지니스 로직
    // 데이터베이스 클라이언트 객체를 가져오기
    auto dbClient = drogon::app().getDbClient();
    
    // DB 함수 호출 SQL
    std::string sql = "SELECT * from create_work_item($1, $2, $3, $4, $5, $6, $7,$8, $9, $10, $11, $12, $13, $14)";
    
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
        // DB 함수에 전달할 매개변수
        requester_email, work_item_id, owner_node_id, owner_user_email, title,
        getStrOrNull("parent_work_item_id"),
        getStrOrNull("description"),
        getBoolOrNull("hidden", false),
        getStrOrNull("status"),
        getIntOrNull("priority", 3),
        getIntOrNull("weight", 1),
        getIntOrNull("progress", 0),
        getStrOrNull("start_date"),
        getStrOrNull("due_date")
    );
}

// work item 업데이트 API
void WorkItemController::updateWorkItem(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback){
    // 1. 데이터 파싱 및 유효성 검사
    // 필수 파라미터 유효성 검사
    auto jsonPtr = req->getJsonObject();
    if(!validateStrings(jsonPtr, "work_item_id")){
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "필수 파라미터(work_item_id)가 누락되었습니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    // JWT 필터에서 설정한 사용자 이메일을 가져오기
    std::string requester_email = req->attributes()->get<std::string>("user_email");
    
    // 필수 파라미터
    std::string work_item_id = (*jsonPtr)["work_item_id"].asString();
    
    // 선택 파라미터
    auto getStrOrNull = [&](const std::string &key) {
        return (*jsonPtr)[key].isNull() ? "" : (*jsonPtr)[key].asString();
    };
    auto getIntOrNull = [&](const std::string &key, int defaultVal) {
        return (*jsonPtr)[key].isNull() ? defaultVal : (*jsonPtr)[key].asInt();
    };
    auto getBoolOrNull = [&](const std::string &key) -> std::optional<bool> {
        if ((*jsonPtr)[key].isNull()) return std::nullopt;
        return (*jsonPtr)[key].asBool();
    };
    

    // 2. 비지니스 로직
    // 데이터베이스 클라이언트 객체를 가져오기
    auto dbClient = drogon::app().getDbClient();
    
    // DB 함수 호출 SQL
    std::string sql = "SELECT * from update_work_item($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)";
    
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
        // DB 함수에 전달할 매개변수
        requester_email,
        work_item_id,
        getStrOrNull("title"),
        getStrOrNull("description"),
        getBoolOrNull("hidden"),
        getStrOrNull("status"),
        getIntOrNull("priority", -1),
        getIntOrNull("weight", -1),
        getIntOrNull("progress", -1),
        getStrOrNull("start_date"),
        getStrOrNull("due_date")
    );
}