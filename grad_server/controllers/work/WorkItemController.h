#pragma once

#include <drogon/HttpController.h>

using namespace drogon;

namespace api
{
class WorkItemController : public drogon::HttpController<WorkItemController>
{
  public:
    METHOD_LIST_BEGIN
    // use METHOD_ADD to add your custom processing function here;
    // METHOD_ADD(WorkItemController::get, "/{2}/{1}", Get); // path is /api/WorkItemController/{arg2}/{arg1}
    // METHOD_ADD(WorkItemController::your_method_name, "/{1}/{2}/list", Get); // path is /api/WorkItemController/{arg1}/{arg2}/list
    // ADD_METHOD_TO(WorkItemController::your_method_name, "/absolute/path/{1}/{2}/list", Get); // path is /absolute/path/{arg1}/{arg2}/list

    ADD_METHOD_TO(WorkItemController::createWorkItem, "/api/workItems", Post, "JwtFilter");
    ADD_METHOD_TO(WorkItemController::updateWorkItem, "/api/workItems", Patch, "JwtFilter");
    ADD_METHOD_TO(WorkItemController::deleteWorkItem, "/api/workItems", Delete, "JwtFilter");
    ADD_METHOD_TO(WorkItemController::addComment, "/api/workItems/comments", Post, "JwtFilter");
    ADD_METHOD_TO(WorkItemController::getWorkItemDetail, "/api/workItems", Get, "JwtFilter");
    
    // 파일 관련 API
    ADD_METHOD_TO(WorkItemController::uploadFile, "/api/workItems/files/upload", Post, "JwtFilter");
    ADD_METHOD_TO(WorkItemController::getFiles, "/api/workItems/files", Get, "JwtFilter");
    ADD_METHOD_TO(WorkItemController::downloadFile, "/api/workItems/files/download", Get, "JwtFilter");
    ADD_METHOD_TO(WorkItemController::deleteFile, "/api/workItems/files", Delete, "JwtFilter");
    
    METHOD_LIST_END
    // your declaration of processing function maybe like this:
    // void get(const HttpRequestPtr& req, std::function<void (const HttpResponsePtr &)> &&callback, int p1, std::string p2);
    // void your_method_name(const HttpRequestPtr& req, std::function<void (const HttpResponsePtr &)> &&callback, double p1, int p2) const;

    void createWorkItem(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback);
    void updateWorkItem(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback);
    void deleteWorkItem(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback);
    void addComment(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback);
    void getWorkItemDetail(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback);

    // 파일 핸들러
    void uploadFile(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback);
    void getFiles(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback);
    void downloadFile(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback);
    void deleteFile(const HttpRequestPtr &req, std::function<void (const HttpResponsePtr &)> &&callback);
};
}
