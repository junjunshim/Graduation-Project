# 역할 변경 api
- 사용자의 노드 역할을 다른 역할로 변경하는 api (14번 비트 NODE_ADD_ROLE 권한 필요)
- `role_id` 는 해당 노드에 정의된 역할(AUTHORITY) 식별 id이며, 역할 이름이 아니라 정의된 역할만 지정할 수 있습니다.
## Request
- Request Syntax
```json
{
    "email" : "test1232@gmail.com",
    "node_id" : 2,
    "role_id" : 35
}
```

| Method | URL |
| :--- | :--- |
| Patch | http://{서버 url}/api/roles |

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
| email | String | 필수 | 역할을 변경할 사용자 email |
| node_id | Integer | 필수 | 노드 식별용 id |
| role_id | Integer | 필수 | 변경할 역할 정의(AUTHORITY) 식별 id |

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "data" : [
        {
            "type" : "ROLE",
            "id" : 24,
            "node_id" : 2,
            "user_id" : "U-121",
            "user_name" : "테스터",
            "email" : "test1232@gmail.com",
            "role" : "MEMBER",
            "role_id" : 35,
            "is_top_role" : false,
            "updated_at" : "2026-03-19 12:29:24.745634+00"
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
| data | Array | 성공 | 변경된 역할 배정 데이터 배열 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 (ROLE) |
| id | Integer | 필수 | 역할 배정 식별 id (assignment_id) |
| node_id | Integer | role | 소속 노드의 id |
| user_id | String | role | 역할이 배정된 사용자 id |
| user_name | String | role | 역할이 배정된 사용자 이름 |
| email | String | role | 역할이 배정된 사용자 이메일 |
| role | String | role | 변경된 역할 이름 |
| role_id | Integer | role | 변경된 역할 정의 id |
| is_top_role | Boolean | role | 최상위 역할(ADMIN) 여부 |
| updated_at | String | 필수 | 데이터의 최신 업데이트 시간 |