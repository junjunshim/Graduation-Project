#include "RecurringRuleController.h"
#include "ResponseUtils.h"
#include "ValidationUtils.h"
#include <json/json.h>
#include <optional>
#include <filesystem>
#include <drogon/utils/Utilities.h>

using namespace api;
using namespace app_utils;

// 1. 노드별 정기 일정 목록 조회
void RecurringRuleController::getRecurringRules(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback) {
    std::string nodeIdStr = req->getParameter("nodeId");
    if (nodeIdStr.empty()) {
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "필수 쿼리 파라미터(nodeId)가 누락되었습니다.";
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    int nodeId = 0;
    try {
        nodeId = std::stoi(nodeIdStr);
    } catch (...) {
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "nodeId는 숫자 형태여야 합니다.";
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    std::string requester_email = req->attributes()->get<std::string>("user_email");
    bool include_deleted = (req->getParameter("include_deleted") == "true");

    auto dbClient = drogon::app().getDbClient();
    std::string sql = "SELECT * FROM get_recurring_rules($1, $2, $3)";

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
        requester_email, nodeId, include_deleted
    );
}

// 2. 단일 정기 일정 상세 조회
void RecurringRuleController::getRecurringRuleDetail(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback, int ruleId) {
    std::string requester_email = req->attributes()->get<std::string>("user_email");

    auto dbClient = drogon::app().getDbClient();
    std::string sql = "SELECT * FROM get_recurring_rule_detail($1, $2)";

    dbClient->execSqlAsync(
        sql,
        [callback](const orm::Result &result) {
            Json::Value ret = parseIntegratedDataResult(result);
            if (ret["data"].isArray() && ret["data"].size() > 0) {
                Json::Value singleResp;
                singleResp["status"] = "success";
                singleResp["data"] = ret["data"][0];
                auto resp = HttpResponse::newHttpJsonResponse(singleResp);
                resp->setStatusCode(k200OK);
                callback(resp);
            } else {
                auto resp = HttpResponse::newHttpJsonResponse(ret);
                resp->setStatusCode(k200OK);
                callback(resp);
            }
        },
        [callback](const orm::DrogonDbException &e) {
            Json::Value ret = parseDbError(e);
            auto statusCode = static_cast<drogon::HttpStatusCode>(ret["http_code"].asInt());
            ret.removeMember("http_code");
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(statusCode);
            callback(resp);
        },
        requester_email, ruleId
    );
}

// 3. 정기 일정 신규 생성
void RecurringRuleController::createRecurringRule(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback) {
    auto jsonPtr = req->getJsonObject();
    if (!jsonPtr || !validateStrings(jsonPtr, "title") || !validateInts(jsonPtr, "owner_node_id")) {
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "필수 파라미터(owner_node_id, title)가 누락되었습니다.";
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    std::string requester_email = req->attributes()->get<std::string>("user_email");

    int owner_node_id = (*jsonPtr)["owner_node_id"].asInt();
    std::string title = (*jsonPtr)["title"].asString();

    auto getStrOrNull = [&](const std::string &key) {
        return (*jsonPtr)[key].isNull() ? "" : (*jsonPtr)[key].asString();
    };
    auto getIntOrNull = [&](const std::string &key, int defaultVal) {
        return (*jsonPtr)[key].isNull() ? defaultVal : (*jsonPtr)[key].asInt();
    };
    auto getBoolOrNull = [&](const std::string &key, bool defaultVal) {
        return (*jsonPtr)[key].isNull() ? defaultVal : (*jsonPtr)[key].asBool();
    };

    std::string assignee_email = getStrOrNull("assignee_user_email");
    std::string description = getStrOrNull("description");
    std::string category = (*jsonPtr)["category"].isNull() ? "ROUTINE" : (*jsonPtr)["category"].asString();
    std::string frequency = (*jsonPtr)["frequency"].isNull() ? "DAILY" : (*jsonPtr)["frequency"].asString();
    int interval_value = getIntOrNull("interval_value", 1);
    std::string by_day = getStrOrNull("by_day");
    
    std::optional<int> by_month_day = std::nullopt;
    if (jsonPtr->isMember("by_month_day") && !(*jsonPtr)["by_month_day"].isNull()) {
        by_month_day = (*jsonPtr)["by_month_day"].asInt();
    }

    std::optional<int> by_set_pos = std::nullopt;
    if (jsonPtr->isMember("by_set_pos") && !(*jsonPtr)["by_set_pos"].isNull()) {
        by_set_pos = (*jsonPtr)["by_set_pos"].asInt();
    }

    std::string start_time = getStrOrNull("start_time");
    int duration_minutes = getIntOrNull("duration_minutes", 60);
    std::string repeat_start_date = getStrOrNull("repeat_start_date");
    std::string repeat_end_date = getStrOrNull("repeat_end_date");

    std::optional<int> max_occurrences = std::nullopt;
    if (jsonPtr->isMember("max_occurrences") && !(*jsonPtr)["max_occurrences"].isNull()) {
        max_occurrences = (*jsonPtr)["max_occurrences"].asInt();
    }

    bool exclude_holidays = getBoolOrNull("exclude_holidays", true);
    std::string holiday_action = (*jsonPtr)["holiday_action"].isNull() ? "SKIP" : (*jsonPtr)["holiday_action"].asString();
    bool auto_create_task = getBoolOrNull("auto_create_task", false);

    std::string checklistsJsonStr = "[]";
    if (jsonPtr->isMember("checklists") && (*jsonPtr)["checklists"].isArray()) {
        Json::StreamWriterBuilder writer;
        writer["indentation"] = "";
        checklistsJsonStr = Json::writeString(writer, (*jsonPtr)["checklists"]);
    }

    auto dbClient = drogon::app().getDbClient();
    std::string sql = "SELECT * FROM create_recurring_rule($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20::jsonb)";

    dbClient->execSqlAsync(
        sql,
        [callback](const orm::Result &result) {
            Json::Value ret = parseIntegratedDataResult(result);
            if (ret["data"].isArray() && ret["data"].size() > 0) {
                Json::Value singleResp;
                singleResp["status"] = "success";
                singleResp["data"] = ret["data"][0];
                auto resp = HttpResponse::newHttpJsonResponse(singleResp);
                resp->setStatusCode(k201Created);
                callback(resp);
            } else {
                auto resp = HttpResponse::newHttpJsonResponse(ret);
                resp->setStatusCode(k201Created);
                callback(resp);
            }
        },
        [callback](const orm::DrogonDbException &e) {
            Json::Value ret = parseDbError(e);
            auto statusCode = static_cast<drogon::HttpStatusCode>(ret["http_code"].asInt());
            ret.removeMember("http_code");
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(statusCode);
            callback(resp);
        },
        requester_email, owner_node_id, assignee_email, title, description,
        category, frequency, interval_value, by_day, by_month_day,
        by_set_pos, start_time, duration_minutes, repeat_start_date, repeat_end_date,
        max_occurrences, exclude_holidays, holiday_action, auto_create_task, checklistsJsonStr
    );
}

// 4. 정기 일정 수정
void RecurringRuleController::updateRecurringRule(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback, int ruleId) {
    auto jsonPtr = req->getJsonObject();
    if (!jsonPtr) {
        Json::Value ret;
        ret["status"] = "error";
        ret["code"] = "400";
        ret["message"] = "요청 본문이 누락되었습니다.";
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    std::string requester_email = req->attributes()->get<std::string>("user_email");

    std::optional<std::string> assignee_email = std::nullopt;
    if (jsonPtr->isMember("assignee_user_email") && !(*jsonPtr)["assignee_user_email"].isNull()) {
        assignee_email = (*jsonPtr)["assignee_user_email"].asString();
    }

    std::optional<std::string> title = std::nullopt;
    if (jsonPtr->isMember("title") && !(*jsonPtr)["title"].isNull()) {
        title = (*jsonPtr)["title"].asString();
    }

    std::optional<std::string> description = std::nullopt;
    if (jsonPtr->isMember("description") && !(*jsonPtr)["description"].isNull()) {
        description = (*jsonPtr)["description"].asString();
    }

    std::optional<std::string> category = std::nullopt;
    if (jsonPtr->isMember("category") && !(*jsonPtr)["category"].isNull()) {
        category = (*jsonPtr)["category"].asString();
    }

    std::optional<std::string> frequency = std::nullopt;
    if (jsonPtr->isMember("frequency") && !(*jsonPtr)["frequency"].isNull()) {
        frequency = (*jsonPtr)["frequency"].asString();
    }

    std::optional<int> interval_value = std::nullopt;
    if (jsonPtr->isMember("interval_value") && !(*jsonPtr)["interval_value"].isNull()) {
        interval_value = (*jsonPtr)["interval_value"].asInt();
    }

    std::optional<std::string> by_day = std::nullopt;
    if (jsonPtr->isMember("by_day") && !(*jsonPtr)["by_day"].isNull()) {
        by_day = (*jsonPtr)["by_day"].asString();
    }

    std::optional<int> by_month_day = std::nullopt;
    if (jsonPtr->isMember("by_month_day") && !(*jsonPtr)["by_month_day"].isNull()) {
        by_month_day = (*jsonPtr)["by_month_day"].asInt();
    }

    std::optional<int> by_set_pos = std::nullopt;
    if (jsonPtr->isMember("by_set_pos") && !(*jsonPtr)["by_set_pos"].isNull()) {
        by_set_pos = (*jsonPtr)["by_set_pos"].asInt();
    }

    std::optional<std::string> start_time = std::nullopt;
    if (jsonPtr->isMember("start_time") && !(*jsonPtr)["start_time"].isNull()) {
        start_time = (*jsonPtr)["start_time"].asString();
    }

    std::optional<int> duration_minutes = std::nullopt;
    if (jsonPtr->isMember("duration_minutes") && !(*jsonPtr)["duration_minutes"].isNull()) {
        duration_minutes = (*jsonPtr)["duration_minutes"].asInt();
    }

    std::optional<std::string> repeat_start_date = std::nullopt;
    if (jsonPtr->isMember("repeat_start_date") && !(*jsonPtr)["repeat_start_date"].isNull()) {
        repeat_start_date = (*jsonPtr)["repeat_start_date"].asString();
    }

    std::optional<std::string> repeat_end_date = std::nullopt;
    if (jsonPtr->isMember("repeat_end_date") && !(*jsonPtr)["repeat_end_date"].isNull()) {
        repeat_end_date = (*jsonPtr)["repeat_end_date"].asString();
    }

    std::optional<int> max_occurrences = std::nullopt;
    if (jsonPtr->isMember("max_occurrences") && !(*jsonPtr)["max_occurrences"].isNull()) {
        max_occurrences = (*jsonPtr)["max_occurrences"].asInt();
    }

    std::optional<bool> exclude_holidays = std::nullopt;
    if (jsonPtr->isMember("exclude_holidays") && !(*jsonPtr)["exclude_holidays"].isNull()) {
        exclude_holidays = (*jsonPtr)["exclude_holidays"].asBool();
    }

    std::optional<std::string> holiday_action = std::nullopt;
    if (jsonPtr->isMember("holiday_action") && !(*jsonPtr)["holiday_action"].isNull()) {
        holiday_action = (*jsonPtr)["holiday_action"].asString();
    }

    std::optional<bool> auto_create_task = std::nullopt;
    if (jsonPtr->isMember("auto_create_task") && !(*jsonPtr)["auto_create_task"].isNull()) {
        auto_create_task = (*jsonPtr)["auto_create_task"].asBool();
    }

    std::optional<bool> is_active = std::nullopt;
    if (jsonPtr->isMember("is_active") && !(*jsonPtr)["is_active"].isNull()) {
        is_active = (*jsonPtr)["is_active"].asBool();
    }

    std::optional<std::string> checklistsJsonStr = std::nullopt;
    if (jsonPtr->isMember("checklists") && (*jsonPtr)["checklists"].isArray()) {
        Json::StreamWriterBuilder writer;
        writer["indentation"] = "";
        checklistsJsonStr = Json::writeString(writer, (*jsonPtr)["checklists"]);
    }

    auto dbClient = drogon::app().getDbClient();
    std::string sql = "SELECT * FROM update_recurring_rule($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21::jsonb)";

    dbClient->execSqlAsync(
        sql,
        [callback](const orm::Result &result) {
            Json::Value ret = parseIntegratedDataResult(result);
            if (ret["data"].isArray() && ret["data"].size() > 0) {
                Json::Value singleResp;
                singleResp["status"] = "success";
                singleResp["data"] = ret["data"][0];
                auto resp = HttpResponse::newHttpJsonResponse(singleResp);
                resp->setStatusCode(k200OK);
                callback(resp);
            } else {
                auto resp = HttpResponse::newHttpJsonResponse(ret);
                resp->setStatusCode(k200OK);
                callback(resp);
            }
        },
        [callback](const orm::DrogonDbException &e) {
            Json::Value ret = parseDbError(e);
            auto statusCode = static_cast<drogon::HttpStatusCode>(ret["http_code"].asInt());
            ret.removeMember("http_code");
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(statusCode);
            callback(resp);
        },
        requester_email, ruleId, assignee_email, title, description,
        category, frequency, interval_value, by_day, by_month_day,
        by_set_pos, start_time, duration_minutes, repeat_start_date, repeat_end_date,
        max_occurrences, exclude_holidays, holiday_action, auto_create_task, is_active, checklistsJsonStr
    );
}

// 5. 정기 일정 삭제
void RecurringRuleController::deleteRecurringRule(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback, int ruleId) {
    std::string requester_email = req->attributes()->get<std::string>("user_email");

    auto dbClient = drogon::app().getDbClient();
    std::string sql = "SELECT * FROM delete_recurring_rule($1, $2)";

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
        requester_email, ruleId
    );
}

// 6. 정기 일정 복구
void RecurringRuleController::restoreRecurringRule(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback, int ruleId) {
    std::string requester_email = req->attributes()->get<std::string>("user_email");
    std::string cascadeParam = req->getParameter("cascade");
    bool cascade = (cascadeParam == "true" || cascadeParam == "1");

    auto dbClient = drogon::app().getDbClient();
    std::string sql = "SELECT * FROM restore_recurring_rule($1, $2, $3)";

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
        requester_email, ruleId, cascade
    );
}



// 8. 파일 업로드
void RecurringRuleController::uploadFile(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback, int ruleId) {
    MultiPartParser parser;
    if (parser.parse(req) != 0) {
        Json::Value ret;
        ret["status"] = "error";
        ret["message"] = "멀티파트 폼 데이터 파싱 실패";
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    auto &files = parser.getFiles();
    if (files.empty()) {
        Json::Value ret;
        ret["status"] = "error";
        ret["message"] = "업로드할 파일이 없습니다.";
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k400BadRequest);
        callback(resp);
        return;
    }

    std::string requester_email = req->attributes()->get<std::string>("user_email");
    const auto &uploadFile = files[0];

    std::string original_file_name = uploadFile.getFileName();
    size_t file_size = uploadFile.fileLength();
    std::string mime_type = "";

    std::string uploadDir = "./uploads/recurring_rules/" + std::to_string(ruleId);
    try {
        std::filesystem::create_directories(uploadDir);
    } catch (const std::exception &e) {
        LOG_ERROR << "Failed to create directory: " << e.what();
    }

    std::string extension = "";
    auto dotPos = original_file_name.find_last_of('.');
    if (dotPos != std::string::npos) {
        extension = original_file_name.substr(dotPos);
    }
    std::string stored_file_name = drogon::utils::getUuid() + extension;
    std::string full_path = uploadDir + "/" + stored_file_name;

    if (uploadFile.saveAs(full_path) != 0) {
        Json::Value ret;
        ret["status"] = "error";
        ret["message"] = "파일 저장 중 오류가 발생했습니다.";
        auto resp = HttpResponse::newHttpJsonResponse(ret);
        resp->setStatusCode(k500InternalServerError);
        callback(resp);
        return;
    }

    auto dbClient = drogon::app().getDbClient();
    std::string sql = "SELECT * FROM upload_recurring_rule_file($1, $2, $3, $4, $5, $6, $7)";

    dbClient->execSqlAsync(
        sql,
        [callback](const orm::Result &result) {
            Json::Value ret = parseIntegratedDataResult(result);
            if (ret["data"].isArray() && ret["data"].size() > 0) {
                Json::Value singleResp;
                singleResp["status"] = "success";
                singleResp["data"] = ret["data"][0];
                auto resp = HttpResponse::newHttpJsonResponse(singleResp);
                resp->setStatusCode(k201Created);
                callback(resp);
            } else {
                auto resp = HttpResponse::newHttpJsonResponse(ret);
                resp->setStatusCode(k201Created);
                callback(resp);
            }
        },
        [callback, full_path](const orm::DrogonDbException &e) {
            std::filesystem::remove(full_path);
            Json::Value ret = parseDbError(e);
            auto statusCode = static_cast<drogon::HttpStatusCode>(ret["http_code"].asInt());
            ret.removeMember("http_code");
            auto resp = HttpResponse::newHttpJsonResponse(ret);
            resp->setStatusCode(statusCode);
            callback(resp);
        },
        requester_email, ruleId, original_file_name, stored_file_name, full_path, static_cast<int64_t>(file_size), mime_type
    );
}

// 9. 파일 다운로드
void RecurringRuleController::downloadFile(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback, int fileId) {
    std::string requester_email = req->attributes()->get<std::string>("user_email");
    std::string if_modified_since = req->getHeader("If-Modified-Since");

    auto dbClient = drogon::app().getDbClient();
    std::string sql = "SELECT * FROM get_recurring_rule_file_download($1, $2)";

    dbClient->execSqlAsync(
        sql,
        [callback, if_modified_since](const orm::Result &result) {
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
            std::string updated_at = fileData.isMember("updated_at") ? fileData["updated_at"].asString() : "";

            if (!std::filesystem::exists(file_path)) {
                Json::Value ret;
                ret["status"] = "error";
                ret["message"] = "서버 디스크에 해당 파일이 존재하지 않습니다.";
                auto resp = HttpResponse::newHttpJsonResponse(ret);
                resp->setStatusCode(k404NotFound);
                callback(resp);
                return;
            }

            if (!if_modified_since.empty() && !updated_at.empty() && if_modified_since == updated_at) {
                auto resp = HttpResponse::newHttpResponse();
                resp->setStatusCode(k304NotModified);
                callback(resp);
                return;
            }

            auto resp = HttpResponse::newFileResponse(file_path, original_file_name);
            if (!updated_at.empty()) {
                resp->addHeader("Last-Modified", updated_at);
            }
            resp->addHeader("Cache-Control", "public, max-age=3600");
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
        requester_email, fileId
    );
}

// 10. 파일 삭제
void RecurringRuleController::deleteFile(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback, int fileId) {
    std::string requester_email = req->attributes()->get<std::string>("user_email");

    auto dbClient = drogon::app().getDbClient();
    std::string sql = "SELECT * FROM delete_recurring_rule_file($1, $2)";

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
        requester_email, fileId
    );
}

// 11. 파일 복구
void RecurringRuleController::restoreFile(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback, int fileId) {
    std::string requester_email = req->attributes()->get<std::string>("user_email");

    auto dbClient = drogon::app().getDbClient();
    std::string sql = "SELECT * FROM restore_recurring_rule_file($1, $2)";

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
        requester_email, fileId
    );
}

