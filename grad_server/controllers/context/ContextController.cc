#include "ContextController.h"
#include "ResponseUtils.h"
#include <json/json.h>

using namespace api;
using namespace app_utils;

// Add definition of your processing function here

// 사용자 전체 데이터 로드 API
void ContextController::getInitialContext(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback){
    // 1. 데이터 파싱 및 유효성 검사 
    // JWT 필터에서 설정한 사용자 이메일을 가져오기
    std::string user_email = req->attributes()->get<std::string>("user_email");

    // 2. 비지니스 로직
    // 데이터베이스 클라이언트 객체를 가져오기
    auto dbClient = drogon::app().getDbClient();

    // DB 함수 호출 SQL
    std::string sql = "SELECT * FROM get_initial_context($1)";

    // DB 함수 비동기 실행
    dbClient->execSqlAsync(
        sql,
        // [성공 콜백]
        [callback](const orm::Result &result){
            // DB 결과를 프론트엔드 응답용 JSON으로 변환
            Json::Value ret = parseIntegratedDataResult(result);
            ret["server_time"] = trantor::Date::now().toFormattedString(true);
            
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
        // DB 함수에 전달할 매개변수 (사용자 이메일)
        user_email
    );
}

// 워크스페이스 진입점 경량 스코프 조회 API
void ContextController::getWorkspaceDirectoryScope(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback){
    std::string user_email = req->attributes()->get<std::string>("user_email");
    auto dbClient = drogon::app().getDbClient();

    std::string sql = "SELECT * FROM get_workspace_directory_scope($1)";

    dbClient->execSqlAsync(
        sql,
        [callback](const orm::Result &result){
            Json::Value ret = parseIntegratedDataResult(result);
            ret["server_time"] = trantor::Date::now().toFormattedString(true);
            
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(k200OK);
            callback(resp);
        },
        [callback](const orm::DrogonDbException &e){
            Json::Value ret = parseDbError(e);
            auto statusCode = static_cast<drogon::HttpStatusCode>(ret["http_code"].asInt());
            ret.removeMember("http_code");

            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(statusCode);
            callback(resp);
        },
        user_email
    );
}