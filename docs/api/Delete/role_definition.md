# 역할 삭제 api
- 노드에 정의된 역할(권한 정의)을 삭제하는 api (15번 비트 ROLE_CHANGE 권한 필요)
- 이 역할을 배정받은 사용자가 한 명이라도 남아 있으면 삭제하지 않으며, 사용자 탭에서 먼저 다른 역할로 변경해야 합니다.
- 삭제 전 `GET /api/roles/definition/deletion-preview` 로 삭제 가능 여부를 확인하는 것을 권장합니다.

## Request
- Request syntax
```json
{
    "node_id" : 10,
    "role_id" : 5
}
```

| Method | URL |
| :--- | :--- |
| Delete | http://{서버 url}/api/roles/definition |

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
| node_id | Integer | 필수 | 역할이 정의된 노드 id |
| role_id | Integer | 필수 | 삭제할 역할 정의(AUTHORITY) 식별 id (ADMIN은 삭제 불가) |

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "data" : [
        {
            "type" : "AUTHORITY",
            "action" : "deleted",
            "id" : 5,
            "role_id" : 5,
            "node_id" : 10,
            "role" : "TECH_LEAD",
            "authority" : "001100111111111101111111",
            "is_top_role" : false
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
| data | Array | 성공 | 삭제된 역할 권한 데이터 배열 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 (AUTHORITY) |
| action | String | 필수 | 수행 동작 (deleted) |
| id | Integer | 필수 | 역할 권한 식별 id (authority_id) |
| role_id | Integer | 필수 | 역할 정의 id (id와 동일) |
| node_id | Integer | 필수 | 소속 노드의 id |
| role | String | 필수 | 삭제된 역할 이름 |
| authority | String | 필수 | 삭제 시점의 24비트 권한 문자열 |
| is_top_role | Boolean | 필수 | 최상위 역할(ADMIN) 여부 |

## 정책
- 최상위 담당자(ADMIN) 역할은 삭제할 수 없다.
- 배정된 활성 사용자가 남아 있으면 삭제할 수 없다. 탈퇴한 사용자의 잔여 배정만 함께 정리된다.