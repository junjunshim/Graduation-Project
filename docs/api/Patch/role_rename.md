# 역할 이름 변경 api
- 노드 내 특정 역할의 이름을 변경하는 api (15번 비트 ROLE_CHANGE 권한 필요)
- 해당 역할을 부여받은 멤버들의 역할 할당(role_assignments)도 새 역할명으로 자동 연쇄 갱신됩니다.
- ADMIN 역할은 변경할 수 없으며, 새 이름을 ADMIN으로 변경하는 것도 불가능합니다.

## Request
- Request syntax
```json
{
    "node_id" : 10,
    "old_role_name" : "TECH_LEAD",
    "new_role_name" : "ENGINEERING_LEAD"
}
```

| Method | URL |
| :--- | :--- |
| Patch | http://{서버 url}/api/roles/rename |

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
| node_id | Integer | 필수 | 역할을 수정할 노드 id |
| old_role_name | String | 필수 | 기존 역할 이름 (ADMIN은 변경 불가) |
| new_role_name | String | 필수 | 변경할 새 역할 이름 (ADMIN 사용 불가, 중복 불가) |

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "data" : [
        {
            "type" : "AUTHORITY",
            "id" : 5,
            "node_id" : 10,
            "role" : "ENGINEERING_LEAD",
            "authority" : "001100111111111101111111",
            "updated_at" : "2026-03-19 12:35:24.745634+00"
        },
        {
            "type" : "ROLE",
            "id" : 12,
            "node_id" : 10,
            "email" : "user@apple.com",
            "role" : "ENGINEERING_LEAD",
            "updated_at" : "2026-03-19 12:35:24.745634+00"
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
| data | Array | 성공 | 갱신된 역할 권한 정의 및 소속 멤버 역할 할당 데이터 배열 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements (AUTHORITY)

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 (AUTHORITY) |
| id | Integer | 필수 | 역할 권한 식별 id |
| node_id | Integer | 필수 | 소속 노드의 id |
| role | String | 필수 | 변경된 새 역할 이름 |
| authority | String | 필수 | 24비트 권한 문자열 |
| updated_at | String | 필수 | 데이터의 최신 업데이트 시간 |

- Data Elements (ROLE)

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 (ROLE) |
| id | Integer | 필수 | 역할 할당 식별 id |
| node_id | Integer | 필수 | 소속 노드의 id |
| email | String | 필수 | 해당 역할을 부여받은 사용자 이메일 |
| role | String | 필수 | 변경된 새 역할 이름 |
| updated_at | String | 필수 | 데이터의 최신 업데이트 시간 |
