# 하위 노드 추가 api (version 1.1)
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
| Post | http://{서버 url}/api/v1/org/subNodes |

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
    "status" : "success",
    "data" : {
        "type" : "NODE",
        "id" : "3",
        "parent_id" : "1",
        "title" : "영업 부서",
        "extra_info" : "{1, 3}",
        "updated_at" : "2026-03-19 12:29:24.745634+00"
    }
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
| id | String | 필수 | 노드 식별 id |
| parent_id | String | 필수 | 부모 노드 id |
| title | String | 필수 | 노드 또는 work_item 이름 |
| extra_info | String | 필수 | 노드의 path |
| updated_at | String | 필수 | 데이터의 최신 업데이트 시간 |


---
## 업데이트
### version 1.0 : 서버와 데이터베이스 연결 여부 확인용
- 개선 사항 : token 기능

### version 1.1 : token 기능 추가, 사용자 검증 추가
- 변경 사항 : 기존 user_id를 넘기는 방식에서 token을 사용한 사용자 인증으로 변경, 생성한 노드의 데이터를 반환
- 개선 사항 : 노드 데이터 뿐만 아니라 role 데이터도 반환이 필요

