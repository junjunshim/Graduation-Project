# 최상위 노드 추가 api
- 최상위 노드 추가 api
## Request
- Request syntax
```json
{
    "node_type" : "COMPANY",
    "name" : "테스트 회사"
}
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/api/org/topNodes |

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
| node_type | String | 필수 | 노드의 타입 |
| name | String | 필수 | 노드의 이름 |

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "data" : [
        {
            "type" : "NODE",
            "id" : 4,
            "node_type" : "COMPANY",
            "parent_id" : null,
            "title" : "테스트 회사",
            "path" : [4],
            "updated_at" : "2026-03-19 12:29:24.745634+00"
        },
        {
            "type" : "ROLE",
            "id" : 20,
            "node_id" : 4,
            "email" : "test1234@gmail.com",
            "role" : "ADMIN",
            "updated_at" : "2026-03-19 12:29:24.745634+00"
        },
        {
            "type" : "AUTHORITY",
            "id" : 2,
            "node_id" : 4,
            "role" : "ADMIN",
            "authority" : "011111111111111111111111",
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
| data | Array | 성공 | 생성된 최상위 노드, 관리자 역할 및 기본 권한 데이터 배열 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 (NODE, ROLE, AUTHORITY) |
| id | Integer | 필수 | 데이터 식별 id |
| node_type | String | node | 노드의 타입 |
| parent_id | Null | node | 상위 노드 id (최상위 노드는 항상 null) |
| title | String | node | 노드의 이름 |
| path | Array | node | 노드의 계층 경로 배열 |
| node_id | Integer | role or authority | 소속 노드의 id |
| email | String | role | 역할이 배정된 사용자 이메일 |
| role | String | role or authority | 배정된 역할 이름 (기본값: ADMIN) |
| authority | String | authority | 역할의 기본 권한 비트 |
| updated_at | String | 필수 | 데이터의 최신 업데이트 시간 |