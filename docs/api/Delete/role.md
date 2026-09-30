# 역할 회수 api
- 노드에 직속으로 부여된 사용자의 역할을 회수하는 api
- 완료 업무는 그대로 두고, 미완료 업무는 `new_owner_email` 담당자에게 이관한 뒤 역할 할당을 삭제합니다.
- 해당 노드에 직접 부여된 14번 비트 NODE_ADD_ROLE 권한이 필요합니다.
- 회수 전 `GET /api/roles/removal-preview` 로 이관 대상을 확인하는 것을 권장합니다.

## Request
- Request syntax

이관할 업무가 있는 경우
```json
{
    "email" : "target@example.com",
    "node_id" : 10,
    "new_owner_email" : "new@example.com"
}
```

이관할 미완료 업무가 없는 경우
```json
{
    "email" : "target@example.com",
    "node_id" : 10
}
```

| Method | URL |
| :--- | :--- |
| Delete | http://{서버 url}/api/roles |

---
- Request Header

| 파라미터 | 타입 | 필수여부 | 설명 |
| :--- | :--- | :--- | :--- |
| Content_type | String | 필수 | application/json |
| Authorization | String | 필수 | Bearer 사용자 토큰 |

---
- Request Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| email | String | 필수 | 역할을 회수할 대상 사용자 email |
| node_id | Integer | 필수 | 역할을 회수할 노드 id |
| new_owner_email | String | 선택 | 미완료 업무를 인계받을 새 담당자 email (이관할 업무가 있으면 필수) |

- `new_owner_email` 은 최상위 담당자(ADMIN) 역할, 본인 역할, 이관할 업무가 없을 때는 생략할 수 있다.

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "data" : [
        {
            "type" : "ROLE",
            "action" : "removed",
            "node_id" : 10,
            "user_id" : "U-201",
            "user_name" : "이OO",
            "email" : "target@example.com",
            "role" : "MEMBER",
            "transferred_work_item_count" : 1,
            "transfer_target_user_id" : "U-163",
            "transfer_target_name" : "김OO",
            "transfer_target_email" : "new@example.com",
            "cleared_schedule_count" : 1
        }
    ]
}
```
```json
{
    "status" : "error",
    "message" : {에러 메세지}
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 |
| data | Array | 성공 | 역할 회수 결과 데이터 배열 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 (ROLE) |
| action | String | 필수 | 수행 동작 (removed) |
| node_id | Integer | 필수 | 역할을 회수한 노드 id |
| user_id | String | 필수 | 회수 대상 사용자 id |
| user_name | String | 필수 | 회수 대상 사용자 이름 |
| email | String | 필수 | 회수 대상 사용자 email |
| role | String | 필수 | 회수한 역할 이름 |
| transferred_work_item_count | Integer | 필수 | 이관한 미완료 업무 수 |
| transfer_target_user_id | String or Null | 필수 | 이관 대상 사용자 id (이관 없으면 null) |
| transfer_target_name | String or Null | 필수 | 이관 대상 사용자 이름 (이관 없으면 null) |
| transfer_target_email | String or Null | 필수 | 이관 대상 사용자 email (이관 없으면 null) |
| cleared_schedule_count | Integer | 필수 | 담당자를 미정으로 변경한 정기 일정 수 |

## 정책
- 최상위 담당자(ADMIN) 역할과 본인의 역할은 회수할 수 없다.
- 이관할 미완료 업무가 있으면 `new_owner_email` 이 필수이며, 대상자가 모든 업무(숨김 포함)를 수행할 자격이 있어야 한다. 자격 미달 시 전체가 롤백된다.
- 회수 대상자가 담당자였던 정기 일정은 담당자를 미정(NULL)으로 변경한다.