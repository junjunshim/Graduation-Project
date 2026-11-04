#pragma once

#include <drogon/HttpRequest.h>

#include <cstddef>
#include <string>

namespace app_utils {

// 요청 단위 상관 키. HTTP 헤더를 그대로 믿지 않고 형식을 검증한 뒤 요청 속성에 보관한다.
inline constexpr char kRequestIdAttribute[] = "request_id";
inline constexpr char kRequestIdHeader[] = "X-Request-ID";
inline constexpr std::size_t kMaxRequestIdLength = 128;

// 요청 속성에 ID가 있으면 그대로 쓰고, 없으면 안전한 X-Request-ID 헤더를 채택하거나 UUID를 만든다.
std::string ensureRequestId(const drogon::HttpRequestPtr &req);
std::string requestIdOf(const drogon::HttpRequestPtr &req);

// 로그 한 줄에 넣을 수 있는 rid=... 조각. 값이 없으면 rid=- 로 남긴다.
std::string requestIdTag(const std::string &requestId);

// 로그에 이메일 원문을 남기지 않기 위한 마스킹(samsung_admin@samsung.com -> s***@samsung.com).
std::string maskEmail(const std::string &email);

// 줄바꿈/제어문자를 공백으로 바꾸고 길이를 제한해 한 이벤트가 여러 줄로 깨지지 않게 한다.
std::string sanitizeLogValue(const std::string &value, std::size_t maxLength = 2048);

} // namespace app_utils
