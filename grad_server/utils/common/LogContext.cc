#include "LogContext.h"

#include <drogon/utils/Utilities.h>

#include <algorithm>

namespace {

bool isAsciiAlnum(unsigned char ch) {
    return (ch >= '0' && ch <= '9') || (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z');
}

bool isSafeRequestIdChar(unsigned char ch) {
    return isAsciiAlnum(ch) || ch == '-' || ch == '_' || ch == '.' || ch == ':';
}

bool isSafeRequestId(const std::string &value) {
    if (value.empty() || value.size() > app_utils::kMaxRequestIdLength) {
        return false;
    }
    return std::all_of(value.begin(), value.end(), [](unsigned char ch) {
        return isSafeRequestIdChar(ch);
    });
}

} // namespace

std::string app_utils::ensureRequestId(const drogon::HttpRequestPtr &req) {
    if (!req) {
        return "";
    }

    const std::string existing = req->attributes()->get<std::string>(kRequestIdAttribute);
    if (isSafeRequestId(existing)) {
        return existing;
    }

    std::string requestId = req->getHeader(kRequestIdHeader);
    if (!isSafeRequestId(requestId)) {
        requestId = drogon::utils::getUuid();
    }

    req->attributes()->insert(kRequestIdAttribute, requestId);
    return requestId;
}

std::string app_utils::requestIdOf(const drogon::HttpRequestPtr &req) {
    return ensureRequestId(req);
}

std::string app_utils::requestIdTag(const std::string &requestId) {
    return "rid=" + (requestId.empty() ? std::string("-") : sanitizeLogValue(requestId, kMaxRequestIdLength));
}

std::string app_utils::maskEmail(const std::string &email) {
    if (email.empty()) {
        return "-";
    }

    const std::size_t at = email.find('@');
    if (at == std::string::npos) {
        return email.substr(0, 1) + "***";
    }
    if (at == 0) {
        return "***" + email.substr(at);
    }
    return email.substr(0, 1) + "***" + email.substr(at);
}

std::string app_utils::sanitizeLogValue(const std::string &value, std::size_t maxLength) {
    std::string result = value;
    for (char &ch : result) {
        const unsigned char code = static_cast<unsigned char>(ch);
        if (code < 0x20 || code == 0x7f) {
            ch = ' ';
        }
    }

    if (maxLength > 0 && result.size() > maxLength) {
        result.resize(maxLength);
        result += "...";
    }
    return result;
}
