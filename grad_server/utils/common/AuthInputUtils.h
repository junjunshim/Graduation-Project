#pragma once

#include <string>

namespace app_utils {

std::string trimAuthInput(const std::string &value);
std::string normalizeAuthEmail(const std::string &value);

bool isValidAuthEmail(const std::string &email);
bool isValidSignupUserId(const std::string &userId);
bool isValidSignupDisplayName(const std::string &name);
bool isValidSignupVerificationCode(const std::string &code);
bool isValidSignupPassword(const std::string &password);

}  // namespace app_utils
