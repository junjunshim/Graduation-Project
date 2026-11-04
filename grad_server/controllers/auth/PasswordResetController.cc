#include "PasswordResetController.h"

#include "LogContext.h"
#include "MailService.h"
#include "ResponseUtils.h"
#include "SecureToken.h"
#include "ValidationUtils.h"

#include <json/json.h>

#include <algorithm>
#include <cctype>
#include <regex>

using namespace api;
using namespace app_utils;
using namespace drogon;

namespace {

constexpr const char *kGenericResetMessage =
    "입력한 이메일이 등록되어 있다면 재설정 안내를 보냈습니다. 메일이 보이지 않으면 스팸함을 확인해 주세요.";

std::string trimCopy(const std::string &value) {
    const auto begin = value.find_first_not_of(" \t\r\n");
    if (begin == std::string::npos) {
        return {};
    }
    const auto end = value.find_last_not_of(" \t\r\n");
    return value.substr(begin, end - begin + 1);
}

std::string normalizeEmail(const std::string &value) {
    std::string email = trimCopy(value);
    std::transform(email.begin(), email.end(), email.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return email;
}

std::string normalizeHexToken(const std::string &value) {
    std::string token = trimCopy(value);
    std::transform(token.begin(), token.end(), token.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return token;
}

bool isValidEmail(const std::string &email) {
    if (email.empty() || email.size() > 100) {
        return false;
    }
    static const std::regex pattern(R"(^[^\s@]+@[^\s@]+\.[^\s@]+$)");
    return std::regex_match(email, pattern);
}

HttpResponsePtr resetResponse(const Json::Value &body, HttpStatusCode status) {
    auto response = HttpResponse::newHttpJsonResponse(body);
    response->setStatusCode(status);
    response->addHeader("Cache-Control", "no-store");
    response->addHeader("Pragma", "no-cache");
    return response;
}

Json::Value successResponse(const std::string &message) {
    Json::Value body;
    body["status"] = "success";
    body["message"] = message;
    return body;
}

Json::Value errorResponse(const std::string &message) {
    Json::Value body;
    body["status"] = "error";
    body["message"] = message;
    return body;
}

}  // namespace

void PasswordResetController::requestPasswordReset(
    const HttpRequestPtr &req,
    std::function<void(const HttpResponsePtr &)> &&callback) {
    const auto jsonPtr = req->getJsonObject();
    if (!validateStrings(jsonPtr, "email")) {
        callback(resetResponse(errorResponse("이메일 주소를 입력해 주세요."), k400BadRequest));
        return;
    }

    const std::string email = normalizeEmail((*jsonPtr)["email"].asString());
    if (!isValidEmail(email)) {
        callback(resetResponse(errorResponse("올바른 이메일 형식을 입력해 주세요."), k400BadRequest));
        return;
    }

    std::string rawToken;
    if (!generateSecureToken(rawToken)) {
        LOG_ERROR << "[PasswordReset] event=token.generate_failed " << requestIdTag(requestIdOf(req));
        callback(resetResponse(errorResponse("재설정 링크를 생성하지 못했습니다. 잠시 후 다시 시도해 주세요."),
                               k500InternalServerError));
        return;
    }

    const std::string tokenHash = sha256Hex(rawToken);
    if (!isSha256Hex(tokenHash)) {
        LOG_ERROR << "[PasswordReset] event=token.hash_failed " << requestIdTag(requestIdOf(req));
        callback(resetResponse(errorResponse("재설정 링크를 생성하지 못했습니다. 잠시 후 다시 시도해 주세요."),
                               k500InternalServerError));
        return;
    }

    const PasswordResetConfig config = MailService::loadPasswordResetConfig();
    const std::string requestId = requestIdOf(req);
    auto dbClient = app().getDbClient();
    dbClient->execSqlAsync(
        "SELECT * FROM request_password_reset_token($1, $2, $3, $4, $5)",
        [callback, rawToken, requestId, email](const orm::Result &result) {
            bool requested = false;
            std::string recipient;

            if (!result.empty()) {
                Json::Reader reader;
                Json::Value item;
                if (reader.parse(result[0]["out_data"].as<std::string>(), item)) {
                    requested = item["requested"].asBool();
                    recipient = item["email"].asString();
                }
            }

            if (requested && !recipient.empty()) {
                MailService::sendPasswordResetEmail(recipient, rawToken, requestId);
            } else {
                // Unknown account and cooldown both look identical to the caller.
                LOG_INFO << "[PasswordReset] event=request_ignored " << requestIdTag(requestId)
                         << " recipient=" << maskEmail(email);
            }

            callback(resetResponse(successResponse(kGenericResetMessage), k200OK));
        },
        [callback, req](const orm::DrogonDbException &e) {
            Json::Value body = parseDbError(e, requestIdOf(req));
            const auto status = static_cast<HttpStatusCode>(body["http_code"].asInt());
            body.removeMember("http_code");
            callback(resetResponse(body, status));
        },
        email, tokenHash, config.expiryMinutes, config.cooldownSeconds, config.maxPerHour);
}

void PasswordResetController::confirmPasswordReset(
    const HttpRequestPtr &req,
    std::function<void(const HttpResponsePtr &)> &&callback) {
    const auto jsonPtr = req->getJsonObject();
    if (!validateStrings(jsonPtr, "token", "new_password")) {
        callback(resetResponse(errorResponse("재설정 토큰과 새 비밀번호를 입력해 주세요."), k400BadRequest));
        return;
    }

    const std::string rawToken = normalizeHexToken((*jsonPtr)["token"].asString());
    const std::string newPassword = (*jsonPtr)["new_password"].asString();
    if (!isSha256Hex(rawToken)) {
        callback(resetResponse(errorResponse(
                                   "재설정 링크가 유효하지 않거나 만료되었습니다. 재설정을 다시 요청해 주세요."),
                               k400BadRequest));
        return;
    }

    const std::string tokenHash = sha256Hex(rawToken);
    auto dbClient = app().getDbClient();
    dbClient->execSqlAsync(
        "SELECT consume_password_reset_token($1, $2)",
        [callback](const orm::Result &result) {
            if (result.empty() || !result[0][0].as<bool>()) {
                callback(resetResponse(errorResponse(
                                           "재설정 링크가 유효하지 않거나 만료되었습니다. 재설정을 다시 요청해 주세요."),
                                       k400BadRequest));
                return;
            }
            callback(resetResponse(successResponse("비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요."),
                                   k200OK));
        },
        [callback, req](const orm::DrogonDbException &e) {
            Json::Value body = parseDbError(e, requestIdOf(req));
            const auto status = static_cast<HttpStatusCode>(body["http_code"].asInt());
            body.removeMember("http_code");
            callback(resetResponse(body, status));
        },
        tokenHash, newPassword);
}
