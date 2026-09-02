# 역할 생성 api
- 노드 내 새로운 역할(커스텀 역할)을 생성하고 24비트 초기 권한을 설정하는 api (15번 비트 ROLE_CHANGE 권한 필요)
## Request
- Request syntax
```json
{
    "node_id" : 10,
    "role_name" : "TECH_LEAD",
    "authority" : "001100111111111101111111"
}
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/api/roles/definition |

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
| node_id | Integer | 필수 | 역할을 생성할 노드 id |
| role_name | String | 필수 | 새로 생성할 역할 이름 (중복 불가, ADMIN 생성 불가) |
| authority | String | 필수 | 24비트 2진수 권한 비트마스크 문자열 |

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
            "role" : "TECH_LEAD",
            "authority" : "001100111111111101111111",
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
| data | Array | 성공 | 생성된 역할 권한 데이터 배열 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 (AUTHORITY) |
| id | Integer | 필수 | 역할 권한 식별 id |
| node_id | Integer | 필수 | 소속 노드의 id |
| role | String | 필수 | 생성된 역할 이름 |
| authority | String | 필수 | 24비트 권한 문자열 |
| updated_at | String | 필수 | 데이터의 최신 업데이트 시간 |
