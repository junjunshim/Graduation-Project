# 역할 삭제 사전 확인 api
- 노드에 정의된 역할(권한 정의)을 삭제하기 전, 삭제 가능 여부와 배정된 사용자를 확인하는 api
- 이 역할을 배정받은 사용자가 남아 있으면 삭제할 수 없으며, 사용자 탭에서 먼저 다른 역할로 변경해야 합니다.
- 삭제 전 최종 확인용이며, 데이터를 변경하지 않습니다. (15번 비트 ROLE_CHANGE 권한 필요)
## Request
- Request syntax
```json
{
}
```

| Method | URL |
| :--- | :--- |
| Get | http://{서버 url}/api/roles/definition/deletion-preview?node_id=10&role_id=5 |

---
- Request Header

| 파라미터 | 타입 | 필수여부 | 설명 |
| :--- | :--- | :--- | :--- |
| Content_type | String | 필수 | application/json |
| Authorization | String | 필수 | Bearer 사용자 토큰 |

---
- Request Parameters

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| node_id | Integer | 필수 | 역할이 정의된 노드 id |
| role_id | Integer | 필수 | 삭제할 역할 정의(AUTHORITY) 식별 id |

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "data" : [
        {
            "type" : "ROLE_DEFINITION_DELETION_PREVIEW",
            "can_delete" : false,
            "blocked_reason" : "이 역할을 배정받은 사용자가 2명 있습니다. 사용자 탭에서 먼저 다른 역할로 변경해 주세요.",
            "node_id" : 10,
            "role_id" : 5,
            "role" : "TECH_LEAD",
            "is_top_role" : false,
            "assignee_count" : 2,
            "inactive_assignee_count" : 0,
            "assignees" : [
                { "user_id" : "U-201", "name" : "이OO", "email" : "lee@example.com" },
                { "user_id" : "U-163", "name" : "김OO", "email" : "kim@example.com" }
            ]
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
| data | Array | 성공 | 역할 삭제 사전 확인 결과 데이터 배열 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 (ROLE_DEFINITION_DELETION_PREVIEW) |
| can_delete | Boolean | 필수 | 역할 삭제 가능 여부 |
| blocked_reason | String or Null | 필수 | 삭제 불가 사유 (가능하면 null) |
| node_id | Integer | 필수 | 역할이 정의된 노드 id |
| role_id | Integer | 필수 | 역할 정의 id |
| role | String | 필수 | 역할 이름 |
| is_top_role | Boolean | 필수 | 최상위 역할(ADMIN) 여부 |
| assignee_count | Integer | 필수 | 이 역할을 배정받은 활성 사용자 수 |
| inactive_assignee_count | Integer | 필수 | 탈퇴한 사용자의 잔여 배정 수 (삭제 시 함께 정리) |
| assignees | Array | 필수 | 이 역할을 배정받은 활성 사용자 목록 |

- assignees Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| user_id | String | 필수 | 사용자 id |
| name | String | 필수 | 사용자 이름 |
| email | String | 필수 | 사용자 email |

## 정책
- 최상위 담당자(ADMIN) 역할은 삭제할 수 없다.
- 배정된 활성 사용자가 1명 이상이면 삭제할 수 없다. (`can_delete` = false)