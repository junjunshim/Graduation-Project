# 역할 부여 api
- 유저에게 노드에 대한 권한 부여 api
## Request
- Request syntax
```json
{
    "email" : "test123@gmail.com",
    "node_id" : 12,
    "role_name" : "MANAGER"
}
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/api/roles |

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
| email | String | 필수 | 유저 검색용 email |
| node_id | Integer | 필수 | 권한을 생성할 노드 |
| role_name | String | 필수 | 역할 이름 |

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "data" : [
        {
            "type" : "ROLE",
            "id" : 22,
            "node_id" : 12,
            "email" : "test123@gmail.com",
            "role" : "MANAGER",
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
| data | json | 성공 | 생성한 권한 데이터 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 |
| id | String | 필수 | 데이터 식별 id |
| node_id | Integer | role | 소속 노드의 id |
| email | String | role | 역할이 배정된 인원 |
| role | String | role | 배정된 역할 이름 |
| updated_at | String | 필수 | 데이터의 최신 업데이트 시간 |