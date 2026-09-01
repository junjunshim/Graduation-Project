#include "ValidationUtils.h"

bool app_utils::validateStringParams(const std::shared_ptr<const Json::Value>& jsonPtr, const std::vector<std::string>& paramNames) {
    if (!jsonPtr) return false;
    for (const auto& name : paramNames) {
        const Json::Value& val = (*jsonPtr)[name];
        if (val.isNull() || !val.isString() || val.asString().empty()) {
            return false;
        }
    }
    return true;
}

bool app_utils::validateIntParams(const std::shared_ptr<const Json::Value>& jsonPtr, const std::vector<std::string>& paramNames) {
    if (!jsonPtr) return false;
    for (const auto& name : paramNames) {
        const Json::Value& val = (*jsonPtr)[name];
        if (val.isNull() || !(val.isInt() || val.isInt64() || val.isUInt() || val.isUInt64())) {
            return false;
        }
    }
    return true;
}
