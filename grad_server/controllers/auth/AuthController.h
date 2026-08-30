#pragma once

#include <drogon/HttpController.h>
#include <json/json.h>
#include <chrono>

using namespace drogon;

namespace api
{
class AuthController : public drogon::HttpController<AuthController>
{
  public:
    METHOD_LIST_BEGIN
    // use METHOD_ADD to add your custom processing function here;
    // METHOD_ADD(AuthController::get, "/{2}/{1}", Get); // path is /api/AuthController/{arg2}/{arg1}
    // METHOD_ADD(AuthController::your_method_name, "/{1}/{2}/list", Get); // path is /api/AuthController/{arg1}/{arg2}/list
    // ADD_METHOD_TO(AuthController::your_method_name, "/absolute/path/{1}/{2}/list", Get); // path is /absolute/path/{arg1}/{arg2}/list

    ADD_METHOD_TO(AuthController::loginUser, "/api/users/login", Post);    
    ADD_METHOD_TO(AuthController::refreshUserToken, "/api/users/refresh", Post);    

    METHOD_LIST_END
    // your declaration of processing function maybe like this:
    // void get(const HttpRequestPtr& req, std::function<void (const HttpResponsePtr &)> &&callback, int p1, std::string p2);
    // void your_method_name(const HttpRequestPtr& req, std::function<void (const HttpResponsePtr &)> &&callback, double p1, int p2) const;

    Json::Value generateToken(const std::string &user_id);
    std::string timePointToString(const std::chrono::system_clock::time_point& tp);
    void loginUser(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void refreshUserToken(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
};
}
