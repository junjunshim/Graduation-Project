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
    UpdateNodeError,            // P0303 노드 업데이트 실패
    AddRoleFailed,              // P0401 사용자 역할 부여 실패
    RoleAlreadyExists,          // P0402 사용자 역할 이미 존재
    TargetHasNoRole,            // P0403 변경할 타켓이 노드에 역할 없음
    TargetIsAdmin,              // P0404 변경할 타켓이 ADMIN
    InvalidRoleChange,          // P0405 변경할 역할이 부적절함
    RoleChangeFailed,           // P0406 사용자 역할 변경 실패
    EmailAlreadyExists,         // P0501 이미 존재하는 이메일
    UserRegistrationFailed,     // P0502 사용자 등록 실패
    EmailNotFound,              // P0503 이메일 찾을 수 없음
    IncorrectPassword,          // P0504 비밀번호 틀림
    LoginFailed,                // P0505 로그인 실패
    DeleteUserError,            // P0506 사용자 삭제 실패
    GetUserProfileFailed,       // P0507 사용자 프로필 조회 실패
    ParentWorkItemNotFound,     // P0601 부모 work item 없음
    CreateWorkItemFailed,       // P0602 work item 생성 실패
    UpdateWorkItemNotFound,     // P0603 업데이트할 work item 없음
    UpdateWorkItemFailed,       // P0604 work item 업데이트 실패
    DeleteWorkItemError,        // P0605 work item 삭제 실패
    CommentWorkItemNotFound,    // P0606 댓글 대상 work item 찾을 수 없음
    DeleteNodeError,            // P0304 노드 삭제 실패
    InvalidActivityFilter,      // P0701 활동 조회 필터 부적절
    FetchActivitiesFailed,      // P0702 활동 조회 실패
    UpdateUserFailed,           // P0508 사용자 정보 수정 실패
    ReadMentionFailed,          // P0509 멘션 알림 읽음 처리 실패
    AddCommentFailed,           // P0607 댓글 등록 실패
    AddMentionFailed,           // P0608 멘션 등록 실패
    GetWorkItemDetailFailed,    // P0609 업무 상세 조회 실패
    AddWorkItemFileFailed,      // P0610 업무 파일 등록 실패
    DeleteWorkItemFileFailed,   // P0611 업무 파일 삭제 실패
    GetWorkItemFilesFailed,     // P0612 업무 파일 목록 조회 실패
    DownloadWorkItemFileFailed, // P0613 업무 파일 다운로드 정보 조회 실패
    LogActivityFailed,          // P0703 활동 로그 기록 실패
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
    // DB 알림 결과(out_data)를 파싱하여 메시지를 주입한 후 웹소켓으로 발송하는 공통 함수
    bool sendNotificationFromDbResult(const drogon::orm::Result &result, const std::string &message = "");
}