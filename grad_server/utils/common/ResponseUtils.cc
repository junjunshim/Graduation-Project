#include "ResponseUtils.h"

// DB 결과를 프론트엔드 응답용 JSON으로 변환하는 공통 함수
Json::Value app_utils::parseIntegratedDataResult(const drogon::orm::Result &result) {
    // 반환 JSON 객체 초기화
    Json::Value ret;
    Json::Value items(Json::arrayValue);

    // DB 결과를 순회하며 items 배열에 추가
    for(auto const &row : result){
        std::string jsonStr = row["out_data"].as<std::string>();
        
        Json::Value item;
        Json::Reader reader;
        if(reader.parse(jsonStr, item)){
            items.append(item);
        } else {
            LOG_ERROR << "Failed to parse integrated JSON data: " << jsonStr;
        }
    }

    // 최종 응답 JSON 객체에 status와 data 필드 추가
    ret["status"] = "success";
    ret["data"] = items;

    // 완성된 JSON 객체 반환
    return ret;
}

// 문자열 에러 메시지에서 Enum으로 변환하는 헬퍼 함수
DbErrorCode app_utils::parseDbErrorCode(const std::string &errMsg) {
    // 에러 메시지에서 PostgreSQL의 사용자 정의 예외 코드(P0001, P0002 등)를 찾아서 DbErrorCode로 변환
    if (errMsg.find("P0001") != std::string::npos) return DbErrorCode::RequesterNotFound;
    else if (errMsg.find("P0002") != std::string::npos) return DbErrorCode::TargetNotFound;
    else if (errMsg.find("P0101") != std::string::npos) return DbErrorCode::AuthorityNotFound;
    else if (errMsg.find("P0102") != std::string::npos) return DbErrorCode::AuthorityCheckFailed;
    else if (errMsg.find("P0103") != std::string::npos) return DbErrorCode::InsufficientAuthority;
    else if (errMsg.find("P0201") != std::string::npos) return DbErrorCode::InitialContextError;
    else if (errMsg.find("P0202") != std::string::npos) return DbErrorCode::SyncContextError;
    else if (errMsg.find("P0301") != std::string::npos) return DbErrorCode::CreateTopNodeError;
    else if (errMsg.find("P0302") != std::string::npos) return DbErrorCode::CreateSubNodeError;
    else if (errMsg.find("P0303") != std::string::npos) return DbErrorCode::UpdateNodeError;
    else if (errMsg.find("P0304") != std::string::npos) return DbErrorCode::DeleteNodeError;
    else if (errMsg.find("P0401") != std::string::npos) return DbErrorCode::AddRoleFailed;
    else if (errMsg.find("P0402") != std::string::npos) return DbErrorCode::RoleAlreadyExists;
    else if (errMsg.find("P0403") != std::string::npos) return DbErrorCode::TargetHasNoRole;
    else if (errMsg.find("P0404") != std::string::npos) return DbErrorCode::TargetIsAdmin;
    else if (errMsg.find("P0405") != std::string::npos) return DbErrorCode::InvalidRoleChange;
    else if (errMsg.find("P0406") != std::string::npos) return DbErrorCode::RoleChangeFailed;
    else if (errMsg.find("P0501") != std::string::npos) return DbErrorCode::EmailAlreadyExists;
    else if (errMsg.find("P0502") != std::string::npos) return DbErrorCode::UserRegistrationFailed;
    else if (errMsg.find("P0503") != std::string::npos) return DbErrorCode::EmailNotFound;
    else if (errMsg.find("P0504") != std::string::npos) return DbErrorCode::IncorrectPassword;
    else if (errMsg.find("P0505") != std::string::npos) return DbErrorCode::LoginFailed;
    else if (errMsg.find("P0506") != std::string::npos) return DbErrorCode::DeleteUserError;
    else if (errMsg.find("P0507") != std::string::npos) return DbErrorCode::GetUserProfileFailed;
    else if (errMsg.find("P0601") != std::string::npos) return DbErrorCode::ParentWorkItemNotFound;
    else if (errMsg.find("P0602") != std::string::npos) return DbErrorCode::CreateWorkItemFailed;
    else if (errMsg.find("P0603") != std::string::npos) return DbErrorCode::UpdateWorkItemNotFound;
    else if (errMsg.find("P0604") != std::string::npos) return DbErrorCode::UpdateWorkItemFailed;
    else if (errMsg.find("P0605") != std::string::npos) return DbErrorCode::DeleteWorkItemError;
    else if (errMsg.find("P0701") != std::string::npos) return DbErrorCode::InvalidActivityFilter;
    else if (errMsg.find("P0702") != std::string::npos) return DbErrorCode::FetchActivitiesFailed;
    else return DbErrorCode::Unknown;
}

// DB 에러 발생 시 Json::Value 반환하는 함수
Json::Value app_utils::parseDbError(const drogon::orm::DrogonDbException &e) {
    // DB 에러 메시지 추출
    std::string errMsg = e.base().what();

    // 에러 메시지를 로그에 기록
    LOG_ERROR << "Database error: " << errMsg;

    // 반환 JSON 객체 초기화
    Json::Value ret;
    ret["status"] = "error";

    // 에러 메시지에서 Enum으로 변환
    DbErrorCode errorCode = parseDbErrorCode(errMsg);

    // Enum 값에 따라 프론트엔드에 반환할 메시지와 HTTP 상태 코드 설정
    switch (errorCode) {
        case DbErrorCode::RequesterNotFound:{
            ret["message"] = "요청자를 찾을 수 없습니다.";
            ret["http_code"] = drogon::k404NotFound;
            break;
        }
        case DbErrorCode::TargetNotFound:{
            ret["message"] = "대상을 찾을 수 없습니다.";
            ret["http_code"] = drogon::k404NotFound;
            break;
        }
        case DbErrorCode::AuthorityNotFound:{
            ret["message"] = "찾을 수 없는 권한입니다.";
            ret["http_code"] = drogon::k400BadRequest;
            break;
        }
        case DbErrorCode::AuthorityCheckFailed:{
            ret["message"] = "권한 체크에 실패했습니다.";
            ret["http_code"] = drogon::k400BadRequest;
            break;
        }
        case DbErrorCode::InsufficientAuthority:{
            ret["message"] = "권한이 부족합니다.";
            ret["http_code"] = drogon::k403Forbidden;
            break;
        }
        case DbErrorCode::InitialContextError:{
            ret["message"] = "사용자 전체 데이터 로드에 실패했습니다.";
            ret["http_code"] = drogon::k500InternalServerError;
            break;
        }
        case DbErrorCode::SyncContextError:{
            ret["message"] = "사용자 변경 데이터 로드에 실패했습니다.";
            ret["http_code"] = drogon::k500InternalServerError;
            break;            
        }
        case DbErrorCode::CreateTopNodeError:{
            ret["message"] = "최상위 노드 생성에 실패했습니다.";
            ret["http_code"] = drogon::k500InternalServerError;
            break;
        }
        case DbErrorCode::CreateSubNodeError:{
            ret["message"] = "하위 노드 생성에 실패했습니다.";
            ret["http_code"] = drogon::k500InternalServerError;
            break;
        }
        case DbErrorCode::UpdateNodeError:{
            ret["message"] = "노드 업데이트에 실패했습니다.";
            ret["http_code"] = drogon::k500InternalServerError;
            break;
        }
        case DbErrorCode::AddRoleFailed:{
            ret["message"] = "사용자 역할 부여에 실패했습니다.";
            ret["http_code"] = drogon::k500InternalServerError;
            break;
        }
        case DbErrorCode::RoleAlreadyExists:{
            ret["message"] = "사용자 역할이 이미 존재합니다.";
            ret["http_code"] = drogon::k400BadRequest;
            break;
        }
        case DbErrorCode::TargetHasNoRole:{
            ret["message"] = "변경할 타켓이 노드에 역할이 없습니다.";
            ret["http_code"] = drogon::k400BadRequest;
            break;
        }
        case DbErrorCode::TargetIsAdmin:{
            ret["message"] = "변경할 타켓이 ADMIN입니다.";
            ret["http_code"] = drogon::k400BadRequest;
            break;
        }
        case DbErrorCode::InvalidRoleChange:{
            ret["message"] = "변경할 역할이 부적절합니다.";
            ret["http_code"] = drogon::k400BadRequest;
            break;
        }
        case DbErrorCode::RoleChangeFailed:{
            ret["message"] = "사용자 역할 변경에 실패했습니다.";
            ret["http_code"] = drogon::k500InternalServerError;
            break;
        }
        case DbErrorCode::EmailAlreadyExists:{
            ret["message"] = "이미 존재하는 이메일입니다.";
            ret["http_code"] = drogon::k400BadRequest;
            break;
        }
        case DbErrorCode::UserRegistrationFailed:{
            ret["message"] = "사용자 등록에 실패했습니다.";
            ret["http_code"] = drogon::k500InternalServerError;
            break;
        }
        case DbErrorCode::ParentWorkItemNotFound:{
            ret["message"] = "부모 work item을 찾을 수 없습니다.";
            ret["http_code"] = drogon::k404NotFound;
            break;
        }
        case DbErrorCode::CreateWorkItemFailed:{
            ret["message"] = "work item 생성에 실패했습니다.";
            ret["http_code"] = drogon::k500InternalServerError;
            break;
        }
        case DbErrorCode::UpdateWorkItemNotFound:{
            ret["message"] = "업데이트할 work item을 찾을 수 없습니다.";
            ret["http_code"] = drogon::k404NotFound;
            break;
        }
        case DbErrorCode::UpdateWorkItemFailed:{
            ret["message"] = "work item 업데이트에 실패했습니다.";
            ret["http_code"] = drogon::k500InternalServerError;
            break;
        }
        case DbErrorCode::DeleteNodeError:{
            ret["message"] = "노드 삭제에 실패했습니다.";
            ret["http_code"] = drogon::k500InternalServerError;
            break;
        }
        case DbErrorCode::EmailNotFound:{
            ret["message"] = "이메일을 찾을 수 없습니다.";
            ret["http_code"] = drogon::k404NotFound;
            break;
        }
        case DbErrorCode::IncorrectPassword:{
            ret["message"] = "비밀번호가 일치하지 않습니다.";
            ret["http_code"] = drogon::k401Unauthorized;
            break;
        }
        case DbErrorCode::LoginFailed:{
            ret["message"] = "로그인 처리에 실패했습니다.";
            ret["http_code"] = drogon::k500InternalServerError;
            break;
        }
        case DbErrorCode::DeleteUserError:{
            ret["message"] = "사용자 삭제에 실패했습니다.";
            ret["http_code"] = drogon::k500InternalServerError;
            break;
        }
        case DbErrorCode::GetUserProfileFailed:{
            ret["message"] = "사용자 정보 조회에 실패했습니다.";
            ret["http_code"] = drogon::k500InternalServerError;
            break;
        }
        case DbErrorCode::DeleteWorkItemError:{
            ret["message"] = "work item 삭제에 실패했습니다.";
            ret["http_code"] = drogon::k500InternalServerError;
            break;
        }
        case DbErrorCode::InvalidActivityFilter:{
            ret["message"] = "활동 조회 필터가 유효하지 않습니다.";
            ret["http_code"] = drogon::k400BadRequest;
            break;
        }
        case DbErrorCode::FetchActivitiesFailed:{
            ret["message"] = "활동 조회에 실패했습니다.";
            ret["http_code"] = drogon::k500InternalServerError;
            break;
        }
        default:{
            ret["message"] = "알 수 없는 데이터베이스 에러가 발생했습니다.";
            ret["http_code"] = drogon::k500InternalServerError;
            break;
        }
    }

    // 완성된 JSON 객체 반환
    return ret;
}