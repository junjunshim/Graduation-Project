#pragma once

#include <drogon/HttpController.h>

using namespace drogon;

namespace api
{
class RoleController : public drogon::HttpController<RoleController>
{
  public:
    METHOD_LIST_BEGIN
    // use METHOD_ADD to add your custom processing function here;
    // METHOD_ADD(RoleController::get, "/{2}/{1}", Get); // path is /api/RoleController/{arg2}/{arg1}
    // METHOD_ADD(RoleController::your_method_name, "/{1}/{2}/list", Get); // path is /api/RoleController/{arg1}/{arg2}/list
    // ADD_METHOD_TO(RoleController::your_method_name, "/absolute/path/{1}/{2}/list", Get); // path is /absolute/path/{arg1}/{arg2}/list

    ADD_METHOD_TO(RoleController::addRole, "/api/roles", Post, "JwtFilter");
    ADD_METHOD_TO(RoleController::updateRole, "/api/roles", Patch, "JwtFilter");
    ADD_METHOD_TO(RoleController::createRoleDefinition, "/api/roles/definition", Post, "JwtFilter");
    ADD_METHOD_TO(RoleController::updateRoleAuthority, "/api/roles/definition", Patch, "JwtFilter");

    METHOD_LIST_END

    void addRole(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void updateRole(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void createRoleDefinition(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
    void updateRoleAuthority(const HttpRequestPtr &req, std::function<void(const HttpResponsePtr &)> &&callback);
};
}
