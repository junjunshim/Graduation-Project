# 하위 노드 추가 api (version 1)
- 상위 노드에 하위 노드 추가 api
## Request
- Request syntax
```json
{
    "node_type" : "DEPARTMENT",
    "parent_node_id" : 10,
    "name" : "테스트 부서",
    "email" : "test3322@gmail.com",
    "role_name" : "ADMIN"
}
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/api/v1/subNodes |

---
- Request Header

| 파라미터 | 타입 | 필수여부 | 설명 |
| :--- | :--- | :--- | :--- |
| Content_type | String | 필수 | application/json |

---
- Request Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| node_type | String | 필수 | 생성할 노드의 타입 |
| parent_node_id | Integer | 필수 | 생성할 노드의 부모 노드 id |
| name | String | 필수 | 생성할 노드의 이름 |
| email | String | 필수 | 생성할 노드의 관리자 이메일 |
| role_name | String | 필수 | 관리자 역할 |


---

## Response
- Response Syntax
```json
{
    "status" : "success"
    "new_node_id" : 12
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
| new_node_id | Integer | 성공 | 생성한 노드 id |
| message | String | 에러 | 요청 관련 메세지 |

---
## 업데이트
### version 1 : 서버와 데이터베이스 연결 여부 확인용
- 개선 사항 : token 기능

