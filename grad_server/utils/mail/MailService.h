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

struct SignupVerificationConfig {
    int codeExpiryMinutes = 10;
    int resendCooldownSeconds = 60;
    int maxPerHour = 5;
    int tokenExpiryMinutes = 15;
    int maxAttempts = 5;
    std::string mailProvider;
    std::string mailApiKey;
    std::string mailFrom;
};

class MailService {
  public:
    static PasswordResetConfig loadPasswordResetConfig();
    static SignupVerificationConfig loadSignupVerificationConfig();

    // Sends asynchronously through the Resend HTTP API. The raw token must never be logged.
    static void sendPasswordResetEmail(const std::string &recipient,
                                       const std::string &rawToken,
                                       const std::string &requestId);
    // Sends a six-digit signup verification code. The code must never be logged.
    static void sendSignupVerificationEmail(const std::string &recipient,
                                            const std::string &code,
                                            int expiryMinutes,
                                            const std::string &requestId);
};

}  // namespace app_utils
