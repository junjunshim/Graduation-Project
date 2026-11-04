#include "SignupVerificationController.h"

#include "AuthInputUtils.h"
#include "LogContext.h"
#include "MailService.h"
#include "ResponseUtils.h"
#include "SecureToken.h"
#include "ValidationUtils.h"

#include <json/json.h>

using namespace api;
using namespace app_utils;
using namespace drogon;

namespace {

constexpr const char *kVerificationRequestMessage =
    "인증번호를 보냈습니다. 메일이 보이지 않으면 스팸함을 확인해 주세요.";
constexpr const char *kVerificationConfirmMessage = "이메일 인증이 완료되었습니다.";
constexpr const char *kVerificationInvalidMessage =
    "인증번호가 올바르지 않거나 만료되었습니다. 인증번호를 다시 확인해 주세요.";

HttpResponsePtr noStoreResponse(const Json::Value &body, HttpStatusCode status) {
    auto response = HttpResponse::newHttpJsonResponse(body);
    response->setStatusCode(status);
    response->addHeader("Cache-Control", "no-store");
    response->addHeader("Pragma", "no-cache");
    return response;
}

Json::Value successBody(const std::string &message) {
    Json::Value body;
    body["status"] = "success";
    body["message"] = message;
    return body;
}

Json::Value errorBody(const std::string &message) {
    Json::Value body;
    body["status"] = "error";
    body["message"] = message;
    return body;
}

bool parseOutData(const orm::Result &result, Json::Value &item) {
    if (result.empty()) {
        return false;
    }
    Json::Reader reader;
    return reader.parse(result[0]["out_data"].as<std::string>(), item);
}

}  // namespace

void SignupVerificationController::requestEmailVerification(
    const HttpRequestPtr &req,
    std::function<void(const HttpResponsePtr &)> &&callback) {
    const auto jsonPtr = req->getJsonObject();
    if (!validateStrings(jsonPtr, "email")) {
        callback(noStoreResponse(errorBody("이메일 주소를 입력해 주세요."), k400BadRequest));
        return;
    }

    const std::string email = normalizeAuthEmail((*jsonPtr)["email"].asString());
    if (!isValidAuthEmail(email)) {
        callback(noStoreResponse(errorBody("올바른 이메일 형식을 입력해 주세요."), k400BadRequest));
        return;
    }

    std::string code;
    if (!generateNumericCode(code, 6)) {
        LOG_ERROR << "[SignupVerification] event=code.generate_failed " << requestIdTag(requestIdOf(req));
        callback(noStoreResponse(errorBody("인증번호를 생성하지 못했습니다. 잠시 후 다시 시도해 주세요."),
                                 k500InternalServerError));
        return;
    }

    const SignupVerificationConfig config = MailService::loadSignupVerificationConfig();
    const std::string requestId = requestIdOf(req);
    auto dbClient = app().getDbClient();
    dbClient->execSqlAsync(
        "SELECT * FROM request_signup_email_verification($1, $2, $3, $4, $5, $6)",
        [callback, code, email, requestId, config](const orm::Result &result) {
            Json::Value item;
            const bool requested = parseOutData(result, item) && item["requested"].asBool();

            if (requested) {
                MailService::sendSignupVerificationEmail(email, code, config.codeExpiryMinutes, requestId);
            } else {
                LOG_INFO << "[SignupVerification] event=request_ignored " << requestIdTag(requestId)
                         << " recipient=" << maskEmail(email);
            }

            callback(noStoreResponse(successBody(kVerificationRequestMessage), k200OK));
        },
        [callback, req](const orm::DrogonDbException &e) {
            Json::Value body = parseDbError(e, requestIdOf(req));
            const auto status = static_cast<HttpStatusCode>(body["http_code"].asInt());
            body.removeMember("http_code");
            callback(noStoreResponse(body, status));
        },
        email,
        code,
        config.codeExpiryMinutes,
        config.resendCooldownSeconds,
        config.maxPerHour,
        config.maxAttempts);
}

void SignupVerificationController::confirmEmailVerification(
    const HttpRequestPtr &req,
    std::function<void(const HttpResponsePtr &)> &&callback) {
    const auto jsonPtr = req->getJsonObject();
    if (!validateStrings(jsonPtr, "email", "code")) {
        callback(noStoreResponse(errorBody("이메일 주소와 인증번호를 입력해 주세요."), k400BadRequest));
        return;
    }

    const std::string email = normalizeAuthEmail((*jsonPtr)["email"].asString());
    const std::string code = trimAuthInput((*jsonPtr)["code"].asString());
    if (!isValidAuthEmail(email) || !isValidSignupVerificationCode(code)) {
        callback(noStoreResponse(errorBody(kVerificationInvalidMessage), k400BadRequest));
        return;
    }

    std::string rawToken;
    if (!generateSecureToken(rawToken)) {
        LOG_ERROR << "[SignupVerification] event=token.generate_failed " << requestIdTag(requestIdOf(req));
        callback(noStoreResponse(errorBody("이메일 인증을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."),
                                 k500InternalServerError));
        return;
    }

    const std::string tokenHash = sha256Hex(rawToken);
    if (!isSha256Hex(tokenHash)) {
        LOG_ERROR << "[SignupVerification] event=token.hash_failed " << requestIdTag(requestIdOf(req));
        callback(noStoreResponse(errorBody("이메일 인증을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."),
                                 k500InternalServerError));
        return;
    }

    const SignupVerificationConfig config = MailService::loadSignupVerificationConfig();
    const std::string requestId = requestIdOf(req);
    auto dbClient = app().getDbClient();
    dbClient->execSqlAsync(
        "SELECT * FROM confirm_signup_email_verification($1, $2, $3, $4)",
        [callback, email, rawToken, requestId, config](const orm::Result &result) {
            Json::Value item;
            const bool verified = parseOutData(result, item) && item["verified"].asBool();
            if (!verified) {
                LOG_INFO << "[SignupVerification] event=confirm_rejected " << requestIdTag(requestId)
                         << " recipient=" << maskEmail(email);
                callback(noStoreResponse(errorBody(kVerificationInvalidMessage), k400BadRequest));
                return;
            }

            Json::Value body = successBody(kVerificationConfirmMessage);
            body["verification_token"] = rawToken;
            body["expires_in_minutes"] = config.tokenExpiryMinutes;
            LOG_INFO << "[SignupVerification] event=confirm_succeeded " << requestIdTag(requestId)
                     << " recipient=" << maskEmail(email);
            callback(noStoreResponse(body, k200OK));
        },
        [callback, req](const orm::DrogonDbException &e) {
            Json::Value body = parseDbError(e, requestIdOf(req));
            const auto status = static_cast<HttpStatusCode>(body["http_code"].asInt());
            body.removeMember("http_code");
            callback(noStoreResponse(body, status));
        },
        email,
        code,
        tokenHash,
        config.tokenExpiryMinutes);
}
