# node 수정 api (version 1.0.0)
- 사용자의 node 또는 권한이 있는 node을 변경하는 api
## Request
- Request Syntax
```json
{
    "node_id" : 2,
    "node_type" : "DEPARTMENT",
    "name" : "변경 이름"
}
```

| Method | URL |
| :--- | :--- |
| Patch | http://{서버 url}/api/v1/org/nodes |

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
| node_id | Integer | 필수 | 식별용 id |
| node_type | String | 선택 | 노드의 타입 |
| name | String | 선택 | 노드의 이름 |

---

## Response
- Response Syntax
```json
{
    "type" : "NODE",
    "id" : "2",
    "node_type" : "변경된 타입",
    "parent_id" : "1" 또는 없음,
    "title" : "변경된 이름",
    "extra_info" : "{1, 2}",
    "updated_at" : "2026-03-19 12:29:24.745634+00"
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
| id | String | 필수 | 노드 식별 id|
| node_type | String | 필수 | node의 type |
| parent_id | String | 선택 | 부모 노드 id |
| title | String | 필수 | 노드 이름 |
| extra_info | String | 필수 | 노드의 path |
| updated_at | String | 필수 | 데이터의 최신 업데이트 시간 |


--- 
## 업데이트
### version 1.0.0 : 업데이트 초기 버전
- 개선 사항 : 