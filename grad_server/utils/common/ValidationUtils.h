#pragma once

#include <json/json.h>
#include <memory>
#include <string>
#include <vector>

namespace app_utils {
    /**
     * @brief JSON 객체 내의 문자열 파라미터들이 유효한지 검사합니다. (비어있지 않은 문자열)
     */
    bool validateStringParams(const std::shared_ptr<const Json::Value>& jsonPtr, const std::vector<std::string>& paramNames);

    /**
     * @brief JSON 객체 내의 정수형 파라미터들이 유효한지 검사합니다. (null 체크)
     */
    bool validateIntParams(const std::shared_ptr<const Json::Value>& jsonPtr, const std::vector<std::string>& paramNames);

    /**
     * @brief 가변 인자를 이용한 편의용 템플릿 함수들
     */
    template<typename... Args>
    bool validateStrings(const std::shared_ptr<const Json::Value>& jsonPtr, Args... args) {
        return validateStringParams(jsonPtr, { args... });
    }

    template<typename... Args>
    bool validateInts(const std::shared_ptr<const Json::Value>& jsonPtr, Args... args) {
        return validateIntParams(jsonPtr, { args... });
    }
}