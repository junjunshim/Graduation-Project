#pragma once

#include <json/json.h>
#include <drogon/drogon.h>
#include <drogon/orm/Result.h>
#include <drogon/orm/Exception.h>

// DB 에러 코드를 나타내는 Enum 클래스
enum class DbErrorCode {
    RequesterNotFound,          // P0001 요청자 없음
    TargetNotFound,             // P0002 대상 없음
    AuthorityNotFound,          // P0101 찾을 수 없는 권한
    AuthorityCheckFailed,       // P0102 권한 체크 실패
    InsufficientAuthority,      // P0103 권한 부족
    InitialContextError,        // P0201 사용자 전체 데이터 로드 실패
    SyncContextError,           // P0202 사용자 변경 데이터 로드 실패
    CreateTopNodeError,         // P0301 최상위 노드 생성 실패
    CreateSubNodeError,         // P0302 하위 노드 생성 실패
    AddRoleFailed,              // P0401 사용자 역할 부여 실패
    RoleAlreadyExists,          // P0402 사용자 역할 이미 존재
    EmailAlreadyExists,         // P0501 이미 존재하는 이메일
    UserRegistrationFailed,     // P0502 사용자 등록 실패
    Unknown                     // 알 수 없는 에러
};

// 유틸리티 함수 네임스페이스
namespace app_utils {
    // DB 결과를 프론트엔드 응답용 JSON으로 변환하는 공통 함수
    Json::Value parseIntegratedDataResult(const drogon::orm::Result &result);
    // 문자열 에러 메시지에서 Enum으로 변환하는 헬퍼 함수
    DbErrorCode parseDbErrorCode(const std::string &errMsg);
    // DB 에러 발생 시 Json::Value 반환하는 함수
    Json::Value parseDbError(const drogon::orm::DrogonDbException &e);
}