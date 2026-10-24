#pragma once

#include <string>

namespace app_utils {

struct PasswordResetConfig {
    int expiryMinutes = 30;
    int cooldownSeconds = 60;
    int maxPerHour = 3;
    std::string resetBaseUrl;
    std::string mailProvider;
    std::string mailApiKey;
    std::string mailFrom;
};

class MailService {
  public:
    static PasswordResetConfig loadPasswordResetConfig();

    // Sends asynchronously through the Resend HTTP API. The raw token must never be logged.
    static void sendPasswordResetEmail(const std::string &recipient,
                                       const std::string &rawToken,
                                       const std::string &requestId);
};

}  // namespace app_utils
