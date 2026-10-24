#include "SecureToken.h"

#include <openssl/evp.h>
#include <openssl/rand.h>

#include <array>
#include <cstddef>

namespace {

std::string toHex(const unsigned char *bytes, std::size_t length) {
    static constexpr char kHex[] = "0123456789abcdef";
    std::string output;
    output.resize(length * 2);
    for (std::size_t i = 0; i < length; ++i) {
        output[i * 2] = kHex[(bytes[i] >> 4) & 0x0f];
        output[i * 2 + 1] = kHex[bytes[i] & 0x0f];
    }
    return output;
}

}  // namespace

bool app_utils::generateSecureToken(std::string &token) {
    std::array<unsigned char, 32> bytes{};
    if (RAND_bytes(bytes.data(), static_cast<int>(bytes.size())) != 1) {
        token.clear();
        return false;
    }
    token = toHex(bytes.data(), bytes.size());
    return true;
}

std::string app_utils::sha256Hex(const std::string &value) {
    EVP_MD_CTX *ctx = EVP_MD_CTX_new();
    if (ctx == nullptr) {
        return {};
    }

    unsigned char digest[EVP_MAX_MD_SIZE]{};
    unsigned int digestLength = 0;
    const bool ok = EVP_DigestInit_ex(ctx, EVP_sha256(), nullptr) == 1 &&
                    EVP_DigestUpdate(ctx, value.data(), value.size()) == 1 &&
                    EVP_DigestFinal_ex(ctx, digest, &digestLength) == 1;
    EVP_MD_CTX_free(ctx);

    if (!ok) {
        return {};
    }
    return toHex(digest, digestLength);
}

bool app_utils::isSha256Hex(const std::string &value) {
    if (value.size() != 64) {
        return false;
    }
    for (const char ch : value) {
        const bool digit = ch >= '0' && ch <= '9';
        const bool lower = ch >= 'a' && ch <= 'f';
        const bool upper = ch >= 'A' && ch <= 'F';
        if (!digit && !lower && !upper) {
            return false;
        }
    }
    return true;
}
