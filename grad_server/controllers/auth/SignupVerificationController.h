#pragma once

#include <drogon/HttpController.h>

using namespace drogon;

namespace api {

class SignupVerificationController : public drogon::HttpController<SignupVerificationController> {
  public:
    METHOD_LIST_BEGIN
    ADD_METHOD_TO(SignupVerificationController::requestEmailVerification,
                  "/api/users/email-verification/request", Post);
    ADD_METHOD_TO(SignupVerificationController::confirmEmailVerification,
                  "/api/users/email-verification/confirm", Post);
    METHOD_LIST_END

    void requestEmailVerification(const HttpRequestPtr &req,
                                  std::function<void(const HttpResponsePtr &)> &&callback);
    void confirmEmailVerification(const HttpRequestPtr &req,
                                  std::function<void(const HttpResponsePtr &)> &&callback);
};

}  // namespace api
