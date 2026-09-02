# node 복구 api
- 휴지통(삭제 상태)에 있는 node를 복구하는 api
## Request
- Request Syntax
```json
{
    "node_id" : 2,
    "cascade" : false
}
```

| Method | URL |
| :--- | :--- |
| Patch | http://{서버 url}/api/org/nodes/restore |

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
| node_id | Integer | 필수 | 복구할 대상 node 식별 id |
| cascade | Boolean | 선택 | 하위 노드 및 소속 업무/파일 일괄 복구 여부 (기본값: false) |

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "data" : [
        {
            "type" : "NODE",
            "id" : 2,
            "node_type" : "DEPARTMENT",
            "parent_id" : 1,
            "title" : "기획부",
            "path" : [1, 2],
            "is_deleted" : false,
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
| data | Array | 성공 | 복구된 노드 데이터 리스트 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 (NODE) |
| id | Integer | 필수 | 노드 식별 id |
| node_type | String | node | 노드의 타입 |
| parent_id | Integer or Null | node | 상위 노드 식별 id |
| title | String | node | 노드 이름 |
| path | Array | node | 노드의 계층 경로 배열 |
| is_deleted | Boolean | node | 삭제 여부 (false) |
| updated_at | String | node | 복구 일시 |
