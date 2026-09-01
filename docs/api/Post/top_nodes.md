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
            "node_type" : "DEPARTMENT",
            "parent_id" : "1" or null,
            "title" : "개발 부서",
            "path" : [1, 4],
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
| data | json | 성공 | 생성한 노드의 데이터 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 |
| id | String | 필수 | 데이터 식별 id |
| node_type | String | node | 노드의 타입 |
| parent_id | Integer | node | 상위 노드 id |
| title | String | node | 노드의 이름 |
| path | Array | node | 노드의 트리구조 |
| node_id | Integer | role or authority | 소속 노드의 id |
| email | String | role | 역할이 배정된 인원 |
| role | String | role or authority | 배정된 역할 이름 |
| authority | String | authority | 역할의 권한 비트 |
| updated_at | String | 필수 | 데이터의 최신 업데이트 시간 |