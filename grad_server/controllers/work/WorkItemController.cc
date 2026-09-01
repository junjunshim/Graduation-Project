#include "WorkItemController.h"
#include "ResponseUtils.h"
#include "ValidationUtils.h"
#include "WorkItems.h"
#include "NotificationWebSocketController.h"
#include <json/json.h>
#include <optional>
#include <regex>
#include <filesystem>
#include <drogon/utils/Utilities.h>

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
        getStrOrNull("category"),
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
    std::string sql = "SELECT * from update_work_item($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)";
    
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
        getStrOrNull("category"),
        getBoolOrNull("hidden"),
        getStrOrNull("status"),
        getIntOrNull("priority", -1),
        getIntOrNull("weight", -1),
        getIntOrNull("progress", -1),
        getStrOrNull("start_date"),
        getStrOrNull("due_date")
    );
}

// work item 삭제(소프트 딜리트) API
void WorkItemController::deleteWorkItem(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback){
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

    // 2. 비지니스 로직
    // 데이터베이스 클라이언트 객체를 가져오기
    auto dbClient = drogon::app().getDbClient();

    // DB 함수 호출 SQL
    std::string sql = "SELECT * from delete_work_item($1, $2)";

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
        // DB 함수에 전달할 매개변수 (요청자 이메일, 업무 ID)
        requester_email, work_item_id
    );
}

// 업무 댓글 추가 및 실시간 멘션 릴레이 API
void WorkItemController::addComment(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback) {
    // 1. 필수 파라미터 확인 및 유효성 검사
    auto jsonPtr = req->getJsonObject();
    if(!validateStrings(jsonPtr, "work_item_id", "content")){
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "필수 파라미터(work_item_id, content)가 누락되었습니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    std::string requester_email = req->attributes()->get<std::string>("user_email");
    std::string work_item_id = (*jsonPtr)["work_item_id"].asString();
    std::string content = (*jsonPtr)["content"].asString();

    // 2. 본문에서 멘션된 이메일들을 정규식으로 안전하게 추출
    // 포맷: <mention email='samsung_admin@samsung.com'>@삼성 관리자</mention> 또는 큰따옴표 포맷
    std::regex mention_regex("<mention email=['\"]([^'\"]+)['\"]>@([^<]+)</mention>");
    std::smatch match;
    std::vector<std::string> mentioned_emails;
    
    auto search_start = content.cbegin();
    while (std::regex_search(search_start, content.cend(), match, mention_regex)) {
        mentioned_emails.push_back(match[1].str()); // 매칭된 이메일들 수집
        search_start = match.suffix().first;
    }

    // 3. 댓글 추가 DB 비동기 함수 실행 (add_work_item_comment)
    auto dbClient = drogon::app().getDbClient();
    std::string sql = "SELECT * FROM add_work_item_comment($1, $2, $3)";

    dbClient->execSqlAsync(
        sql,
        [callback, dbClient, requester_email, work_item_id, mentioned_emails](const orm::Result &result) {
            if (result.empty()) {
                Json::Value ret;
                ret["status"] = "error";
                ret["message"] = "댓글 작성에 실패했습니다.";
                auto resp = HttpResponse::newHttpJsonResponse(ret);
                resp->setStatusCode(k500InternalServerError);
                callback(resp);
                return;
            }

            // 댓글 데이터 변환 및 획득
            Json::Value ret = parseIntegratedDataResult(result);
            auto comment_obj = ret["data"][0];
            int comment_id = comment_obj["comment_id"].asInt();
            std::string author_name = comment_obj["author_name"].asString();

            // 4. 수집된 멘션 이메일들에 대해 순차적으로 DB 적재 및 웹소켓 알림 릴레이
            for (const auto &mentioned_email : mentioned_emails) {
                std::string mentionSql = "SELECT * FROM add_comment_mention($1, $2)";
                
                dbClient->execSqlAsync(
                    mentionSql,
                    [author_name](const orm::Result &mResult) {
                        // DB 결과(out_data)를 파싱하고 API에서 지정한 메시지를 주입하여 웹소켓 전송
                        sendNotificationFromDbResult(mResult, author_name + "님이 댓글에서 회원님을 멘션했습니다.");
                    },
                    [](const orm::DrogonDbException &me) {
                        LOG_ERROR << "Failed to insert comment mention: " << me.base().what();
                    },
                    comment_id, mentioned_email
                );
            }

            // 클라이언트에 최종 댓글 생성 완료 응답 반환
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
        requester_email, work_item_id, content
    );
}

// 단일 업무 상세 및 댓글 목록 통합 조회 API
void WorkItemController::getWorkItemDetail(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback) {
    // 1. 필수 파라미터 확인 (GET Query Parameter)
    std::string work_item_id = req->getParameter("work_item_id");
    if(work_item_id.empty()){
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "필수 파라미터(work_item_id)가 누락되었습니다.";

        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    std::string requester_email = req->attributes()->get<std::string>("user_email");

    // 2. 비즈니스 로직 실행 (get_work_item_detail)
    auto dbClient = drogon::app().getDbClient();
    std::string sql = "SELECT * FROM get_work_item_detail($1, $2)";

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
        [callback](const orm::DrogonDbException &e) {
            Json::Value ret = parseDbError(e);
            auto statusCode = static_cast<drogon::HttpStatusCode>(ret["http_code"].asInt());
            ret.removeMember("http_code");

            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(statusCode);
            callback(resp);
        },
        requester_email, work_item_id
    );
}

// 파일 업로드 API (multipart/form-data)
void WorkItemController::uploadFile(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback) {
    std::string requester_email = req->attributes()->get<std::string>("user_email");

    // 1. 멀티파트 파서 생성
    MultiPartParser parser;
    if (parser.parse(req) != 0) {
        Json::Value ret;
        ret["status"] = "error";
        ret["message"] = "멀티파트 요청 파싱에 실패했습니다.";
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    auto &files = parser.getFiles();
    auto &parameters = parser.getParameters();

    // 필수 파라미터(work_item_id) 확인
    auto itWorkItem = parameters.find("work_item_id");
    if (itWorkItem == parameters.end() || itWorkItem->second.empty() || files.empty()) {
        Json::Value ret;
        ret["status"] = "error";
        ret["message"] = "필수 파라미터(work_item_id) 또는 업로드할 파일이 누락되었습니다.";
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    std::string work_item_id = itWorkItem->second;
    const auto &uploadFile = files[0]; // 단일 파일 처리

    std::string original_file_name = uploadFile.getFileName();
    size_t file_size = uploadFile.fileLength();
    std::string mime_type = ""; // 추후 확장 가능

    // 2. 디스크 저장 경로 및 고유 파일명 생성
    std::string uploadDir = "./uploads/work_items/" + work_item_id;
    try {
        std::filesystem::create_directories(uploadDir);
    } catch (const std::exception &e) {
        LOG_ERROR << "Failed to create directory: " << e.what();
    }

    // UUID 기반 고유 파일명 생성 (확장자 유지)
    std::string extension = "";
    auto dotPos = original_file_name.find_last_of('.');
    if (dotPos != std::string::npos) {
        extension = original_file_name.substr(dotPos);
    }
    std::string stored_file_name = drogon::utils::getUuid() + extension;
    std::string full_path = uploadDir + "/" + stored_file_name;

    // 3. 실제 물리 파일 저장
    if (uploadFile.saveAs(full_path) != 0) {
        Json::Value ret;
        ret["status"] = "error";
        ret["message"] = "파일 저장 중 오류가 발생했습니다.";
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k500InternalServerError);
        callback(resp);
        return;
    }

    // 4. DB 메타데이터 저장 함수 호출 (add_work_item_file)
    auto dbClient = drogon::app().getDbClient();
    std::string sql = "SELECT * FROM add_work_item_file($1, $2, $3, $4, $5, $6, $7)";

    dbClient->execSqlAsync(
        sql,
        [callback](const orm::Result &result) {
            Json::Value ret = parseIntegratedDataResult(result);
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(k201Created);
            callback(resp);
        },
        [callback, full_path](const orm::DrogonDbException &e) {
            // DB 저장 실패 시 업로드된 물리 파일 정리(롤백)
            std::filesystem::remove(full_path);

            Json::Value ret = parseDbError(e);
            auto statusCode = static_cast<drogon::HttpStatusCode>(ret["http_code"].asInt());
            ret.removeMember("http_code");

            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(statusCode);
            callback(resp);
        },
        requester_email, work_item_id, original_file_name, stored_file_name, full_path, static_cast<int64_t>(file_size), mime_type
    );
}

// 파일 목록 조회 API
void WorkItemController::getFiles(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback) {
    std::string work_item_id = req->getParameter("work_item_id");
    if (work_item_id.empty()) {
        Json::Value ret;
        ret["status"] = "error";
        ret["message"] = "필수 쿼리 파라미터(work_item_id)가 누락되었습니다.";
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    std::string requester_email = req->attributes()->get<std::string>("user_email");

    auto dbClient = drogon::app().getDbClient();
    std::string sql = "SELECT * FROM get_work_item_files($1, $2)";

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
        requester_email, work_item_id
    );
}

// 파일 다운로드 API (스트리밍 바이너리 반환)
void WorkItemController::downloadFile(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback) {
    std::string file_id_str = req->getParameter("file_id");
    if (file_id_str.empty()) {
        Json::Value ret;
        ret["status"] = "error";
        ret["message"] = "필수 쿼리 파라미터(file_id)가 누락되었습니다.";
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    int file_id = std::stoi(file_id_str);
    std::string requester_email = req->attributes()->get<std::string>("user_email");

    // 1. DB에서 파일 경로 및 권한 검증 (get_work_item_file_download)
    auto dbClient = drogon::app().getDbClient();
    std::string sql = "SELECT * FROM get_work_item_file_download($1, $2)";

    dbClient->execSqlAsync(
        sql,
        [callback](const orm::Result &result) {
            if (result.empty()) {
                Json::Value ret;
                ret["status"] = "error";
                ret["message"] = "파일을 찾을 수 없습니다.";
                auto resp = HttpResponse::newHttpJsonResponse(ret);
                resp->setStatusCode(k404NotFound);
                callback(resp);
                return;
            }

            Json::Value parsed = parseIntegratedDataResult(result);
            auto fileData = parsed["data"][0];
            std::string file_path = fileData["file_path"].asString();
            std::string original_file_name = fileData["original_file_name"].asString();

            // 2. 물리 파일 존재 여부 확인
            if (!std::filesystem::exists(file_path)) {
                Json::Value ret;
                ret["status"] = "error";
                ret["message"] = "서버 디스크에 해당 파일이 존재하지 않습니다.";
                auto resp = HttpResponse::newHttpJsonResponse(ret);
                resp->setStatusCode(k404NotFound);
                callback(resp);
                return;
            }

            // 3. 파일 다운로드 스트리밍 응답 반환
            auto resp = HttpResponse::newFileResponse(file_path, original_file_name, CT_APPLICATION_OCTET_STREAM);
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
        requester_email, file_id
    );
}

// 파일 삭제 API
void WorkItemController::deleteFile(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback) {
    auto jsonPtr = req->getJsonObject();
    if (!validateInts(jsonPtr, "file_id")) {
        Json::Value ret;
        ret["status"] = "error";
        ret["message"] = "필수 파라미터(file_id)가 누락되었습니다.";
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    int file_id = (*jsonPtr)["file_id"].asInt();
    std::string requester_email = req->attributes()->get<std::string>("user_email");

    auto dbClient = drogon::app().getDbClient();
    std::string sql = "SELECT * FROM delete_work_item_file($1, $2)";

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
        requester_email, file_id
    );
}