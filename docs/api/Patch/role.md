# 권한 수정 api
- 사용자의 노드 권한을 수정하는 api
## Request
- Request Syntax
```json
{
    "email" : "test1232@gmail.com",
    "node_id" : 2,
    "node_type" : "ADMIN"
}
```

| Method | URL |
| :--- | :--- |
| Patch | http://{서버 url}/api/v1/org/roles |

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
| email | String | 필수 | 사용자 식별용 email  |
| node_id | Integer | 필수 | 노드 식별용 id |
| node_type | String | 선택 | 노드의 타입 |

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
            "email" : "test1232@gmail.com",
            "role" : "ADMIN",
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
| data | Array | 성공 | 조회된 모든 데이터를 담은 배열 |
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