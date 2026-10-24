#pragma once

#include <json/json.h>
#include <drogon/drogon.h>
#include <drogon/orm/Result.h>
#include <drogon/orm/Exception.h>
#include "LogContext.h"

// DB 에러 코드를 나타내는 Enum 클래스
enum class DbErrorCode {
    RequesterNotFound,          // P0001 요청자 없음
    TargetNotFound,             // P0002 대상 없음
    AuthorityNotFound,          // P0101 찾을 수 없는 권한
    AuthorityCheckFailed,       // P0102 권한 체크 실패
    InsufficientAuthority,      // P0103 권한 부족
    InitialContextError,        // P0201 사용자 전체 데이터 로드 실패
    WorkspaceScopeError,        // P0202 워크스페이스 스코프 조회 실패
    DashboardContextError,      // P0203 대시보드 데이터 로드 실패
    CreateTopNodeError,         // P0301 최상위 노드 생성 실패
    CreateSubNodeError,         // P0302 하위 노드 생성 실패
    UpdateNodeError,            // P0303 노드 업데이트 실패
    AddRoleFailed,              // P0401 사용자 역할 부여 실패
    RoleAlreadyExists,          // P0402 사용자 역할 이미 존재
    TargetHasNoRole,            // P0403 변경할 타켓이 노드에 역할 없음
    TargetIsAdmin,              // P0404 변경할 타켓이 ADMIN
    InvalidRoleChange,          // P0405 변경할 역할이 부적절함
    RoleChangeFailed,           // P0406 사용자 역할 변경 실패
    RoleNotDefined,             // P0407 노드에 정의되지 않은 역할
    RoleNameEmpty,              // P0408 역할 이름이 비어있음
    CannotModifyAdminRole,      // P0409 ADMIN 역할은 생성/수정 불가
    InvalidAuthorityBit,        // P0410 유효하지 않은 권한 비트 문자열(비트 폭 불일치)
    CreateRoleDefinitionFailed, // P0411 역할 정의 생성 실패
    RoleDefinitionAlreadyExists,// P0412 노드에 이미 존재하는 역할 정의
    UpdateRoleAuthorityFailed,  // P0413 역할 권한 수정 실패
    RenameRoleDefinitionFailed, // P0414 역할 이름 변경 실패
    SelfRoleRemovalNotAllowed,  // P0415 본인의 역할은 회수할 수 없음
    RoleRemovalTransferInvalid, // P0416 업무 이관 대상이 없거나 자격 미달
    RemoveRoleFailed,           // P0417 사용자 역할 회수 실패
    RoleRemovalPreviewFailed,   // P0418 역할 회수 사전 확인 실패
    RoleDefinitionInUse,        // P0419 역할 정의에 배정된 사용자가 남아 있음
    RoleDeletionPreviewFailed,  // P0420 역할 삭제 사전 확인 실패
    DeleteRoleDefinitionFailed, // P0421 역할 정의 삭제 실패
    EmailAlreadyExists,         // P0501 이미 존재하는 이메일
    UserRegistrationFailed,     // P0502 사용자 등록 실패
    InvalidCredentials,         // P0503/P0504 로그인 실패(계정 존재 여부 비노출)
    LoginFailed,                // P0505 로그인 실패
    DeleteUserError,            // P0506 사용자 삭제 실패
    GetUserProfileFailed,       // P0507 사용자 프로필 조회 실패
    UserIdAlreadyExists,        // P0510 이미 존재하는 유저 ID
    PasswordResetTokenInvalid,  // P0511 재설정 토큰 없음·만료·사용됨
    PasswordPolicyViolation,    // P0512 비밀번호 정책 위반
    PasswordResetFailed,        // P0513 비밀번호 재설정 처리 실패
    ParentWorkItemNotFound,     // P0601 부모 work item 없음
    CreateWorkItemFailed,       // P0602 work item 생성 실패
    UpdateWorkItemNotFound,     // P0603 업데이트할 work item 없음
    UpdateWorkItemFailed,       // P0604 work item 업데이트 실패
    DeleteWorkItemError,        // P0605 work item 삭제 실패
    CommentWorkItemNotFound,    // P0606 댓글 대상 work item 찾을 수 없음
    DeleteNodeError,            // P0304 노드 삭제 실패
    GetNodeDetailFailed,        // P0305 노드 상세 조회 실패
    ParentNodeIsDeleted,        // P0306 상위 노드가 삭제되어 복구 불가
    RestoreNodeFailed,          // P0307 노드 복구 실패
    MoveNodeInvalidDestination, // P0320 이전할 수 없는 목적지이거나 이관 대상 지정 불가
    MoveNodePreviewStale,       // P0321 사전 검사 이후 이전 대상 정보 변경
    MoveNodeTransferInvalid,    // P0322 이관 대상 업무를 맡을 담당자 지정 필요
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
    OwnerNodeIsDeleted,         // P0614 소속 노드가 삭제되어 업무 복구 불가
    NewParentWorkItemDeleted,   // P0615 새 부모 업무가 없거나 삭제됨
    ParentWorkItemIsDeleted,    // P0616 기존 부모 업무가 삭제되어 복구 불가
    RestoreWorkItemFailed,      // P0617 업무 복구 실패
    WorkItemIsDeletedForFile,   // P0618 소속 업무가 삭제되어 파일 복구 불가
    RestoreWorkItemFileFailed,  // P0619 파일 복구 실패
    InvalidParentHierarchy,     // P0620 부모 업무를 자기 자신/하위 업무로 지정
    ParentNodeOutOfScope,       // P0621 부모 업무가 현재 노드/직속 상위 노드 범위 밖
    LogActivityFailed,          // P0703 활동 로그 기록 실패
    RepoNotConnected,           // P0801 저장소나 브랜치가 연결되어 있지 않음
    GithubCredentialInvalid,    // P0802 GitHub 자격증명이 없거나 무효
    GithubScopeInsufficient,    // P0803 GitHub 토큰 스코프 부족
    GithubPushDenied,           // P0804 GitHub push 권한 없음
    GitNonFastForward,          // P0805 non-fast-forward
    GithubKeyNotConfigured,     // P0806 GitHub 자격증명 암호화 키 미설정
    GithubOperationFailed,      // P0807 저장소/자격증명 처리 실패
    RepoCloneFailed,            // P0808 저장소 clone 실패
    BranchHasPresence,          // P0809 브랜치에 작업 중인 사용자가 있음
    BranchHasLocalChanges,      // P0810 브랜치에 커밋되지 않은 변경이 있음
    HandoffCodeInvalid,         // P0811 핸드오프 코드가 없거나 만료/재사용됨
    ExtensionTokenInvalid,      // P0812 확장 리프레시 토큰이 없거나 만료/이미 회전됨
    PathAlreadyExists,          // P0813 파일·디렉터리가 이미 있음
    PathNotFound,               // P0814 파일·디렉터리를 찾을 수 없음
    NodeDeletedForRepo,         // P0815 연결된 노드(워크스페이스)가 삭제되어 저장소를 쓸 수 없음
    ChannelNotFound,            // P0901 존재하지 않거나 삭제된 채널
    ChannelNameDuplicate,       // P0902 워크스페이스 내 동일한 채널명 중복
    CannotDeleteDefaultChannel, // P0903 기본(#일반) 채널 삭제 불가
    CannotDmSelf,               // P0904 본인 이메일로 DM 생성 불가
    ChatMessageNotFound,        // P0905 채팅 메시지 또는 첨부파일을 찾을 수 없음
    ChatOperationFailed,        // P0906 채널/메시지 처리 실패
    Unknown                     // 알 수 없는 에러
};

// 유틸리티 함수 네임스페이스
namespace app_utils {
    // DB 결과를 프론트엔드 응답용 JSON으로 변환하는 공통 함수
    Json::Value parseIntegratedDataResult(const drogon::orm::Result &result);
    // DB 결과에서 HTTP 응답 데이터와 실시간 WebSocket 알림(target_email 포함)을 분리하여 발송 및 반환하는 함수
    Json::Value parseAndDispatchChatResult(const drogon::orm::Result &result);
    // 문자열 에러 메시지에서 Enum으로 변환하는 헬퍼 함수
    DbErrorCode parseDbErrorCode(const std::string &errMsg);
    // DB 에러 발생 시 Json::Value 반환하는 함수
    Json::Value parseDbError(const drogon::orm::DrogonDbException &e, const std::string &requestId = "");
    // DB 알림 결과(out_data)를 파싱하여 메시지를 주입한 후 웹소켓으로 발송하는 공통 함수
    bool sendNotificationFromDbResult(const drogon::orm::Result &result, const std::string &message = "", const Json::Value &extra = Json::Value());
}
