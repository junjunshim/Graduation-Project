#pragma once

#include <drogon/HttpController.h>

using namespace drogon;

namespace api
{
class OrgController : public drogon::HttpController<OrgController>
{
  public:
    METHOD_LIST_BEGIN
    // use METHOD_ADD to add your custom processing function here;
    // METHOD_ADD(OrgController::get, "/{2}/{1}", Get); // path is /api/OrgController/{arg2}/{arg1}
    // METHOD_ADD(OrgController::your_method_name, "/{1}/{2}/list", Get); // path is /api/OrgController/{arg1}/{arg2}/list
    // ADD_METHOD_TO(OrgController::your_method_name, "/absolute/path/{1}/{2}/list", Get); // path is /absolute/path/{arg1}/{arg2}/list
    
    ADD_METHOD_TO(OrgController::createTopNode, "/api/org/topNodes", Post, "JwtFilter");
    ADD_METHOD_TO(OrgController::createSubNode, "/api/org/subNodes", Post, "JwtFilter");
    ADD_METHOD_TO(OrgController::updateNode, "/api/org/nodes", Patch, "JwtFilter");

    METHOD_LIST_END
    // your declaration of processing function maybe like this:
    // void get(const HttpRequestPtr& req, std::function<void (const HttpResponsePtr &)> &&callback, int p1, std::string p2);
    // void your_method_name(const HttpRequestPtr& req, std::function<void (const HttpResponsePtr &)> &&callback, double p1, int p2) const;

    void createTopNode(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void createSubNode(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void updateNode(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
};
}
