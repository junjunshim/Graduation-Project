#include "WorkItemController.h"
#include "ResponseUtils.h"
#include "WorkItems.h"
#include <json/json.h>

using namespace api;
using namespace app_utils;

// 모델 사용을 위한 네임스페이스
using namespace drogon_model::grad_project;

// Add definition of your processing function here
void WorkItemController::createWorkItem(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback){
    // 1. 데이터 파싱 및 유효성 검사
    // JWT 필터에서 설정한 사용자 이메일을 가져오기
    std::string requester_email = req->attributes()->get<std::string>("user_email");
    
    // 요청 바디에서 JSON 데이터 파싱
    auto jsonPtr = req->getJsonObject();

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

    // 필수 파라미터 유효성 검사
    if(!jsonPtr || (*jsonPtr)["work_item_id"].isNull() || (*jsonPtr)["owner_node_id"].isNull() || (*jsonPtr)["owner_user_email"].isNull() || (*jsonPtr)["title"].isNull()){
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "필수 파라미터(work_item_id, owner_node_id, owner_user_email, title)가 누락되었습니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

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

void WorkItemController::updateWorkItem(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback){
    auto jsonPtr = req->getJsonObject();

    // 1. 유효성 검사
    if(!jsonPtr || (*jsonPtr)["work_item_id"].isNull()){
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "필수 파라미터(work_item_id)가 누락되었습니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    // 2. 비지니스 로직
    auto dbClient = drogon::app().getDbClient();

    std::string sql = "SELECT * from update_work_item($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)";

    // 필수 파라미터
    std::string requester_email = req->attributes()->get<std::string>("user_email");
    std::string work_item_id = (*jsonPtr)["work_item_id"].asString();
    
    // 선택 파라미터
    auto getStrOrNull = [&](const std::string &key) {
        return (*jsonPtr)[key].isNull() ? "" : (*jsonPtr)[key].asString();
    };
    auto getIntOrNull = [&](const std::string &key, int defaultVal) {
        return (*jsonPtr)[key].isNull() ? defaultVal : (*jsonPtr)[key].asInt();
    };  

    dbClient->execSqlAsync(
        sql,
        [callback](const orm::Result &result) {
            if (result.empty()) {
                Json::Value ret;
                ret["status"] = "error";
                ret["message"] = "work_item 업데이트에 실패했습니다.";
                auto resp = HttpResponse::newHttpJsonResponse(ret);
                resp->setStatusCode(k500InternalServerError);
                callback(resp);
                return;
            }
            Json::Value ret;
            Json::Value item;

            auto row = result[0];
            
            bool success = row["out_res_status"].as<bool>();

            if(success){
                ret["status"] = "success";
                ret["message"] = row["out_message"].as<std::string>();

                ret["status"] = "success";
                ret["message"] = row["out_message"].as<std::string>();

                
                item["type"] = row["out_type"].as<std::string>();
                item["id"] = row["out_id"].as<std::string>();

                if(!row["out_parent_id"].isNull() && !row["out_parent_id"].as<std::string>().empty()){
                    item["parent_id"] = row["out_parent_id"].as<std::string>();
                }

                item["title"] = row["out_title"].as<std::string>();

                item["status"] = row["out_status"].as<std::string>();
                item["priority"] = row["out_priority"].as<int>();

                if (!row["out_extra_info"].isNull()) {
                    item["extra_info"] = row["out_extra_info"].as<std::string>();
                }

                item["updated_at"] = row["out_updated_at"].as<std::string>();

                ret["data"] = item;

                auto resp = HttpResponse::newHttpJsonResponse(ret);
                resp->setStatusCode(k201Created);
                callback(resp);
            }
            else{
                ret["status"] = "error";
                ret["message"] = row["out_message"].as<std::string>();
                auto resp = HttpResponse::newHttpJsonResponse(ret);
                resp->setStatusCode(k403Forbidden);
                callback(resp);
            }
        },
        [callback](const orm::DrogonDbException &e) {
            Json::Value ret;
            ret["status"] = "error";
            ret["message"] = e.base().what();
            
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(k500InternalServerError);
            callback(resp);
        },
        requester_email,
        work_item_id,
        getStrOrNull("title"),
        getStrOrNull("description"),
        getStrOrNull("status"),
        getIntOrNull("priority", -1),
        getIntOrNull("weight", -1),
        getIntOrNull("progress", -1),
        getStrOrNull("start_date"),
        getStrOrNull("due_date")
    );
}