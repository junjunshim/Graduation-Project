#include "AuthInputUtils.h"

#include <algorithm>
#include <cctype>
#include <cstddef>

namespace {

std::size_t utf8Length(const std::string &value) {
    return static_cast<std::size_t>(std::count_if(value.begin(), value.end(), [](unsigned char ch) {
        return (ch & 0xc0) != 0x80;
    }));
}

}  // namespace

std::string app_utils::trimAuthInput(const std::string &value) {
    const auto isNotSpace = [](unsigned char ch) { return std::isspace(ch) == 0; };
    const auto begin = std::find_if(value.begin(), value.end(), isNotSpace);
    if (begin == value.end()) {
        return {};
    }
    const auto end = std::find_if(value.rbegin(), value.rend(), isNotSpace).base();
    return std::string(begin, end);
}

std::string app_utils::normalizeAuthEmail(const std::string &value) {
    std::string email = trimAuthInput(value);
    std::transform(email.begin(), email.end(), email.begin(), [](unsigned char ch) {
        return static_cast<char>(std::tolower(ch));
    });
    return email;
}

bool app_utils::isValidAuthEmail(const std::string &email) {
    if (email.empty() || utf8Length(email) > 100) {
        return false;
    }

    const auto at = email.find('@');
    if (at == std::string::npos || at == 0 || at + 1 >= email.size() ||
        email.find('@', at + 1) != std::string::npos) {
        return false;
    }

    const auto dot = email.find('.', at + 1);
    if (dot == std::string::npos || dot == at + 1 || dot + 1 >= email.size()) {
        return false;
    }

    return std::none_of(email.begin(), email.end(), [](unsigned char ch) {
        return std::isspace(ch) != 0;
    });
}

bool app_utils::isValidSignupUserId(const std::string &userId) {
    if (userId.size() < 4 || userId.size() > 30) {
        return false;
    }

    const auto isAlnum = [](unsigned char ch) {
        return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9');
    };
    if (!isAlnum(static_cast<unsigned char>(userId.front()))) {
        return false;
    }

    return std::all_of(userId.begin(), userId.end(), [&](unsigned char ch) {
        return isAlnum(ch) || ch == '-' || ch == '_';
    });
}

bool app_utils::isValidSignupDisplayName(const std::string &name) {
    return !name.empty() && utf8Length(name) <= 50;
}

bool app_utils::isValidSignupVerificationCode(const std::string &code) {
    if (code.size() != 6) {
        return false;
    }
    return std::all_of(code.begin(), code.end(), [](unsigned char ch) {
        return ch >= '0' && ch <= '9';
    });
}

bool app_utils::isValidSignupPassword(const std::string &password) {
    if (password.size() < 8 || password.size() > 64) {
        return false;
    }

    const bool hasLetter = std::any_of(password.begin(), password.end(), [](unsigned char ch) {
        return (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z');
    });
    const bool hasDigit = std::any_of(password.begin(), password.end(), [](unsigned char ch) {
        return ch >= '0' && ch <= '9';
    });
    const auto hasSpecial = [](unsigned char ch) {
        const std::string specials = "@$!%*#?&~^_+=[]{}|:;.,<>/?-";
        return specials.find(static_cast<char>(ch)) != std::string::npos;
    };
    const bool hasSpecialCharacter = std::any_of(password.begin(), password.end(), hasSpecial);
    return hasLetter && hasDigit && hasSpecialCharacter;
}
