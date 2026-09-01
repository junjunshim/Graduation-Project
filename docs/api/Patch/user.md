# user 정보 수정 api
- 사용자의 정보 수정 api
## Request
- Request Syntax
```json
{
    "target_email" : "target@gmail.com",
    "name" : "홍길동",
    "password" : "password@1123" 
}
```

| Method | URL |
| :--- | :--- |
| Patch | http://{서버 url}/api/users |

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
| target_email | String | 필수 | 변경할 사용자 이메일 |
| name | String | 선택 | 변경할 이름 |
| password | String | 선택 | 변경할 비밀번호 |

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "data" : [
        {
            "type" : "USER",
            "id" : "U-121",
            "email" : "target@gmail.com",
            "name" : "홍길동",
            "personal_node_id" : 12,
            "created_at" : "2026-03-19 12:29:24.745634+00",
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
| email | String | 필수 | 유저 이메일 |
| name | String | 필수 | 유저 이름 |
| personal_node_id | Integer | 필수 | 개인 공간 노드 id |
| created_at | Array | 필수 | 유저 가입날짜 |
| updated_at | String | 필수 | 데이터의 최신 업데이트 시간 |