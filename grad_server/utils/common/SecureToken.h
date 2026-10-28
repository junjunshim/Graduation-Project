#pragma once

#include <cstddef>
#include <string>

namespace app_utils {

// 256-bit CSPRNG token as lowercase hex. The raw value is only embedded in the email link.
bool generateSecureToken(std::string &token);

// Cryptographically secure numeric code for one-time email verification.
bool generateNumericCode(std::string &code, std::size_t length = 6);

// SHA-256 lowercase hex digest used as the DB lookup key.
std::string sha256Hex(const std::string &value);

bool isSha256Hex(const std::string &value);

}  // namespace app_utils
