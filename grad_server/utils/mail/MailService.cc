#include "MailService.h"

#include "LogContext.h"

#include <drogon/drogon.h>
#include <json/json.h>

#include <memory>
#include <sstream>

using namespace drogon;

namespace {

std::string configString(const Json::Value &config, const char *key, const std::string &fallback = {}) {
    if (!config.isObject() || !config.isMember(key)) {
        return fallback;
    }
    const Json::Value &value = config[key];
    return value.isString() ? value.asString() : fallback;
}

int configInt(const Json::Value &config, const char *key, int fallback) {
    if (!config.isObject() || !config.isMember(key) || !config[key].isInt()) {
        return fallback;
    }
    return config[key].asInt();
}

std::string trimTrailingSlashes(std::string value) {
    while (!value.empty() && value.back() == '/') {
        value.pop_back();
    }
    return value;
}

std::string buildResetLink(const std::string &baseUrl, const std::string &rawToken) {
    // Tokens are lowercase hex, so no URL escaping is required here.
    return trimTrailingSlashes(baseUrl) + "/reset-password/#token=" + rawToken;
}

std::string buildTextBody(const std::string &link, int expiryMinutes) {
    return "Axis 비밀번호 재설정 안내\n\n"
           "아래 링크에서 새 비밀번호를 설정해 주세요.\n" + link + "\n\n" +
           "이 링크는 " + std::to_string(expiryMinutes) + "분 동안 한 번만 사용할 수 있습니다.\n" +
           "본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다.\n";
}

std::string buildHtmlBody(const std::string &link, int expiryMinutes) {
    return std::string(R"HTML(<!doctype html>
<html lang="ko"><body style="margin:0;padding:32px;background:#f5f1eb;font-family:Arial,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#241f1a;">
  <div style="max-width:520px;margin:0 auto;padding:32px;border:1px solid #ddd3c7;border-radius:16px;background:#ffffff;">
    <div style="font-size:22px;font-weight:800;letter-spacing:-0.03em;color:#7a5c43;">Axis</div>
    <h1 style="margin:24px 0 12px;font-size:22px;line-height:1.35;">비밀번호 재설정 안내</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.7;color:#5f554a;">아래 버튼을 눌러 새 비밀번호를 설정해 주세요.</p>
    <p style="margin:0 0 24px;"><a href=")HTML") + link +
           R"HTML(" style="display:inline-block;padding:13px 22px;border-radius:10px;background:#7a5c43;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;">비밀번호 재설정</a></p>
    <p style="margin:0 0 8px;font-size:13px;line-height:1.7;color:#5f554a;">이 링크는 )HTML" +
           std::to_string(expiryMinutes) +
           R"HTML(분 동안 한 번만 사용할 수 있습니다.</p>
    <p style="margin:0;font-size:13px;line-height:1.7;color:#8b7d6f;">본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다. 비밀번호는 이 메일에 표시되지 않습니다.</p>
  </div>
</body></html>)HTML";
}

std::string buildSignupCodeTextBody(const std::string &code, int expiryMinutes) {
    std::ostringstream body;
    body << "Axis 회원가입 인증번호 안내" << std::endl << std::endl;
    body << "인증번호: " << code << std::endl << std::endl;
    body << "이 인증번호는 " << expiryMinutes << "분 동안 한 번만 사용할 수 있습니다." << std::endl;
    body << "본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다." << std::endl;
    return body.str();
}

std::string buildSignupCodeHtmlBody(const std::string &code, int expiryMinutes) {
    return std::string(R"HTML(<!doctype html>
<html lang="ko"><body style="margin:0;padding:32px;background:#f5f1eb;font-family:Arial,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#241f1a;">
  <div style="max-width:520px;margin:0 auto;padding:32px;border:1px solid #ddd3c7;border-radius:16px;background:#ffffff;">
    <div style="font-size:22px;font-weight:800;letter-spacing:-0.03em;color:#7a5c43;">Axis</div>
    <h1 style="margin:24px 0 12px;font-size:22px;line-height:1.35;">회원가입 인증번호</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.7;color:#5f554a;">아래 6자리 인증번호를 회원가입 화면에 입력해 주세요.</p>
    <div style="margin:0 0 24px;padding:18px;border-radius:12px;background:#f5f1eb;text-align:center;font-size:32px;font-weight:800;letter-spacing:0.22em;color:#241f1a;">)HTML") + code +
           R"HTML(</div>
    <p style="margin:0;font-size:13px;line-height:1.7;color:#8b7d6f;">이 인증번호는 )HTML" +
           std::to_string(expiryMinutes) +
           R"HTML(분 동안 한 번만 사용할 수 있습니다. 본인이 요청하지 않았다면 이 메일을 무시하셔도 됩니다.</p>
  </div>
</body></html>)HTML";
}
}  // namespace

app_utils::PasswordResetConfig app_utils::MailService::loadPasswordResetConfig() {
    const Json::Value config = app().getCustomConfig();
    PasswordResetConfig result;
    result.expiryMinutes = configInt(config, "password_reset_expire_minutes", 30);
    result.cooldownSeconds = configInt(config, "password_reset_cooldown_seconds", 60);
    result.maxPerHour = configInt(config, "password_reset_max_per_hour", 3);
    result.resetBaseUrl = configString(config, "password_reset_base_url", "https://axisflow.team");
    result.mailProvider = configString(config, "mail_provider", "resend");
    result.mailApiKey = configString(config, "mail_api_key");
    result.mailFrom = configString(config, "mail_from", "Axis <no-reply@axisflow.team>");
    return result;
}

app_utils::SignupVerificationConfig app_utils::MailService::loadSignupVerificationConfig() {
    const Json::Value config = app().getCustomConfig();
    SignupVerificationConfig result;
    result.codeExpiryMinutes = configInt(config, "signup_verification_code_expire_minutes", 10);
    result.resendCooldownSeconds = configInt(config, "signup_verification_resend_cooldown_seconds", 60);
    result.maxPerHour = configInt(config, "signup_verification_max_per_hour", 5);
    result.tokenExpiryMinutes = configInt(config, "signup_verification_token_expire_minutes", 15);
    result.maxAttempts = configInt(config, "signup_verification_max_attempts", 5);
    result.mailProvider = configString(config, "mail_provider", "resend");
    result.mailApiKey = configString(config, "mail_api_key");
    result.mailFrom = configString(config, "mail_from", "Axis <no-reply@axisflow.team>");
    return result;
}

void app_utils::MailService::sendPasswordResetEmail(const std::string &recipient,
                                                    const std::string &rawToken,
                                                    const std::string &requestId) {
    const PasswordResetConfig config = loadPasswordResetConfig();
    if (config.mailProvider.empty() || config.mailProvider != "resend" || config.mailApiKey.empty() ||
        config.resetBaseUrl.empty() || config.mailFrom.empty()) {
        LOG_WARN << "[Mail] event=password_reset.disabled " << requestIdTag(requestId)
                 << " recipient=" << maskEmail(recipient)
                 << " reason=mail_config_incomplete";
        return;
    }

    const std::string link = buildResetLink(config.resetBaseUrl, rawToken);
    Json::Value payload(Json::objectValue);
    payload["from"] = config.mailFrom;
    payload["to"].append(recipient);
    payload["subject"] = "[Axis] 비밀번호 재설정 안내";
    payload["text"] = buildTextBody(link, config.expiryMinutes);
    payload["html"] = buildHtmlBody(link, config.expiryMinutes);

    Json::StreamWriterBuilder writer;
    writer["indentation"] = "";
    const std::string body = Json::writeString(writer, payload);
    const std::string idempotencyKey = "password-reset-" + requestId;
    const std::string apiKey = config.mailApiKey;

    app().getLoop()->queueInLoop([body, recipient, requestId, idempotencyKey, apiKey]() {
        auto client = HttpClient::newHttpClient("https://api.resend.com", app().getLoop());
        auto apiRequest = HttpRequest::newHttpRequest();
        apiRequest->setMethod(Post);
        apiRequest->setPath("/emails");
        apiRequest->addHeader("Authorization", "Bearer " + apiKey);
        apiRequest->addHeader("Content-Type", "application/json");
        apiRequest->addHeader("Accept", "application/json");
        apiRequest->addHeader("Idempotency-Key", idempotencyKey);
        apiRequest->setBody(body);

        client->sendRequest(apiRequest, [client, recipient, requestId](ReqResult result,
                                                                       const HttpResponsePtr &response) {
            if (result != ReqResult::Ok || response == nullptr) {
                LOG_ERROR << "[Mail] event=password_reset.send_failed " << requestIdTag(requestId)
                          << " recipient=" << maskEmail(recipient)
                          << " reason=transport";
                return;
            }

            const int status = static_cast<int>(response->getStatusCode());
            if (status < 200 || status >= 300) {
                LOG_ERROR << "[Mail] event=password_reset.send_failed " << requestIdTag(requestId)
                          << " recipient=" << maskEmail(recipient)
                          << " status=" << status
                          << " provider_message="
                          << sanitizeLogValue(std::string(response->getBody()), 512);
                return;
            }

            LOG_INFO << "[Mail] event=password_reset.sent " << requestIdTag(requestId)
                     << " recipient=" << maskEmail(recipient)
                     << " status=" << status;
        });
    });
}

void app_utils::MailService::sendSignupVerificationEmail(const std::string &recipient,
                                                         const std::string &code,
                                                         int expiryMinutes,
                                                         const std::string &requestId) {
    const SignupVerificationConfig config = loadSignupVerificationConfig();
    if (config.mailProvider.empty() || config.mailProvider != "resend" || config.mailApiKey.empty() ||
        config.mailFrom.empty()) {
        LOG_WARN << "[Mail] event=signup_verification.disabled " << requestIdTag(requestId)
                 << " recipient=" << maskEmail(recipient)
                 << " reason=mail_config_incomplete";
        return;
    }

    Json::Value payload(Json::objectValue);
    payload["from"] = config.mailFrom;
    payload["to"].append(recipient);
    payload["subject"] = "[Axis] 회원가입 인증번호 안내";
    payload["text"] = buildSignupCodeTextBody(code, expiryMinutes);
    payload["html"] = buildSignupCodeHtmlBody(code, expiryMinutes);

    Json::StreamWriterBuilder writer;
    writer["indentation"] = "";
    const std::string body = Json::writeString(writer, payload);
    const std::string idempotencyKey = "signup-verification-" + requestId;
    const std::string apiKey = config.mailApiKey;

    app().getLoop()->queueInLoop([body, recipient, requestId, idempotencyKey, apiKey]() {
        auto client = HttpClient::newHttpClient("https://api.resend.com", app().getLoop());
        auto apiRequest = HttpRequest::newHttpRequest();
        apiRequest->setMethod(Post);
        apiRequest->setPath("/emails");
        apiRequest->addHeader("Authorization", "Bearer " + apiKey);
        apiRequest->addHeader("Content-Type", "application/json");
        apiRequest->addHeader("Accept", "application/json");
        apiRequest->addHeader("Idempotency-Key", idempotencyKey);
        apiRequest->setBody(body);

        client->sendRequest(apiRequest, [client, recipient, requestId](ReqResult result,
                                                                       const HttpResponsePtr &response) {
            if (result != ReqResult::Ok || response == nullptr) {
                LOG_ERROR << "[Mail] event=signup_verification.send_failed " << requestIdTag(requestId)
                          << " recipient=" << maskEmail(recipient)
                          << " reason=transport";
                return;
            }

            const int status = static_cast<int>(response->getStatusCode());
            if (status < 200 || status >= 300) {
                LOG_ERROR << "[Mail] event=signup_verification.send_failed " << requestIdTag(requestId)
                          << " recipient=" << maskEmail(recipient)
                          << " status=" << status
                          << " provider_message="
                          << sanitizeLogValue(std::string(response->getBody()), 512);
                return;
            }

            LOG_INFO << "[Mail] event=signup_verification.sent " << requestIdTag(requestId)
                     << " recipient=" << maskEmail(recipient)
                     << " status=" << status;
        });
    });
}
