#pragma once

#include <drogon/HttpController.h>

using namespace drogon;

namespace api
{
class RecurringRuleController : public drogon::HttpController<RecurringRuleController>
{
  public:
    METHOD_LIST_BEGIN
    // 정기 일정 CRUD
    ADD_METHOD_TO(RecurringRuleController::getRecurringRules, "/api/recurringRules", Get, "JwtFilter");
    ADD_METHOD_TO(RecurringRuleController::getRecurringRuleDetail, "/api/recurringRules/{1}", Get, "JwtFilter");
    ADD_METHOD_TO(RecurringRuleController::createRecurringRule, "/api/recurringRules", Post, "JwtFilter");
    ADD_METHOD_TO(RecurringRuleController::updateRecurringRule, "/api/recurringRules/{1}", Put, "JwtFilter");
    ADD_METHOD_TO(RecurringRuleController::deleteRecurringRule, "/api/recurringRules/{1}", Delete, "JwtFilter");
    ADD_METHOD_TO(RecurringRuleController::restoreRecurringRule, "/api/recurringRules/{1}/restore", Patch, "JwtFilter");

    // 독립 첨부파일 관련 API
    ADD_METHOD_TO(RecurringRuleController::uploadFile, "/api/recurringRules/{1}/files", Post, "JwtFilter");
    ADD_METHOD_TO(RecurringRuleController::downloadFile, "/api/recurringRules/files/{1}/download", Get, "JwtFilter");
    ADD_METHOD_TO(RecurringRuleController::deleteFile, "/api/recurringRules/files/{1}", Delete, "JwtFilter");
    ADD_METHOD_TO(RecurringRuleController::restoreFile, "/api/recurringRules/files/{1}/restore", Patch, "JwtFilter");

    METHOD_LIST_END

    void getRecurringRules(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback);
    void getRecurringRuleDetail(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback, int ruleId);
    void createRecurringRule(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback);
    void updateRecurringRule(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback, int ruleId);
    void deleteRecurringRule(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback, int ruleId);
    void restoreRecurringRule(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback, int ruleId);

    // 파일 핸들러
    void uploadFile(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback, int ruleId);
    void downloadFile(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback, int fileId);
    void deleteFile(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback, int fileId);
    void restoreFile(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback, int fileId);
};
}
