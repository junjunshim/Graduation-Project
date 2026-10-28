#pragma once

#include <drogon/HttpController.h>

using namespace drogon;

namespace api {

class PasswordResetController : public drogon::HttpController<PasswordResetController> {
  public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(PasswordResetController::requestPasswordReset, "/api/users/password-reset/request", Post);
    ADD_METHOD_TO(PasswordResetController::confirmPasswordReset, "/api/users/password-reset/confirm", Post);
    METHOD_LIST_END

    void requestPasswordReset(const HttpRequestPtr &req,
                              std::function<void(const HttpResponsePtr &)> &&callback);
    void confirmPasswordReset(const HttpRequestPtr &req,
                              std::function<void(const HttpResponsePtr &)> &&callback);
};

}  // namespace api
