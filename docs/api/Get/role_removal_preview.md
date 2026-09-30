# 역할 회수 사전 확인 api
- 노드에 직속으로 부여된 사용자의 역할을 회수하기 전, 회수 가능 여부와 이관해야 할 업무/이관 후보를 확인하는 api
- 실제 회수는 `DELETE /api/roles` 로 수행하며, 본 api는 데이터를 변경하지 않습니다.
- 해당 노드에 직접 부여된 14번 비트 NODE_ADD_ROLE 권한이 필요합니다.
## Request
- Request syntax
```json
{
}
```

| Method | URL |
| :--- | :--- |
| Get | http://{서버 url}/api/roles/removal-preview?email=target@example.com&node_id=10 |

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
| email | String | 필수 | 역할을 회수할 대상 사용자 email |
| node_id | Integer | 필수 | 역할을 회수할 노드 id |

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "data" : [
        {
            "type" : "ROLE_REMOVAL_PREVIEW",
            "can_remove" : true,
            "blocked_reason" : null,
            "node_id" : 10,
            "target_user_id" : "U-201",
            "target_user_name" : "이OO",
            "target_user_email" : "target@example.com",
            "role_id" : 35,
            "role" : "MEMBER",
            "is_top_role" : false,
            "work_items" : [
                {
                    "work_item_id" : "WI-104",
                    "title" : "API 명세 정리",
                    "owner_node_id" : 10,
                    "owner_node_name" : "백엔드 개발",
                    "hidden" : false,
                    "status" : "todo"
                }
            ],
            "transfer_targets" : [
                { "user_id" : "U-163", "name" : "김OO", "email" : "new@example.com" }
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
| data | Array | 성공 | 역할 회수 사전 확인 결과 데이터 배열 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 (ROLE_REMOVAL_PREVIEW) |
| can_remove | Boolean | 필수 | 역할 회수 가능 여부 |
| blocked_reason | String or Null | 필수 | 회수 불가 사유 (가능하면 null) |
| node_id | Integer | 필수 | 역할을 회수할 노드 id |
| target_user_id | String | 필수 | 대상 사용자 id |
| target_user_name | String | 필수 | 대상 사용자 이름 |
| target_user_email | String | 필수 | 대상 사용자 email |
| role_id | Integer | 필수 | 대상 사용자의 역할 정의 id |
| role | String | 필수 | 대상 사용자의 역할 이름 |
| is_top_role | Boolean | 필수 | 최상위 역할(ADMIN) 여부 |
| work_items | Array | 필수 | 회수 시 이관해야 할 미완료 업무 목록 |
| transfer_targets | Array | 필수 | 이관 대상 업무를 모두 수행할 수 있는 사용자 목록 |

- work_items Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| work_item_id | String | 필수 | 업무 식별 id |
| title | String | 필수 | 업무 제목 (숨김 업무 조회 권한이 없으면 "숨김 업무") |
| owner_node_id | Integer | 필수 | 업무 소속 node 식별 id |
| owner_node_name | String | 필수 | 업무 소속 node 이름 |
| hidden | Boolean | 필수 | 숨김 업무 여부 |
| status | String | 필수 | 업무 상태값 |

- transfer_targets Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| user_id | String | 필수 | 사용자 id |
| name | String | 필수 | 사용자 이름 |
| email | String | 필수 | 사용자 email |

## 정책
- 대상 사용자가 해당 노드에 **직속** 역할을 보유해야 한다. 상속 멤버는 회수 대상이 아니다.
- 최상위 담당자(ADMIN) 역할, 본인 역할, 이관 대상이 없는 경우에는 `can_remove` 가 false 이다.
- 완료 업무는 이관 대상에서 제외되며, 미완료 업무만 이관 대상이다.