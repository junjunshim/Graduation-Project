# user 정보 조회 api
- 특정 사용자의 기본 정보 조회 api
## Request
- Request Syntax
```json
{
}
```

| Method | URL |
| :--- | :--- |
| Get | http://{서버 url}/api/users?target_email=target@gmail.com |

---
- Request Header

| 파라미터 | 타입 | 필수여부 | 설명 |
| :--- | :--- | :--- | :--- |
| Content_type | String | 필수 | application/json |
| Authorization | String | 필수 | Bearer 사용자 토큰 | 

---
- Request Parameters

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| target_email | String | 필수 | 조회할 사용자 이메일 |

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "data" : [
        // 1. target_email과 요청자가 동일할 때 (본인 정보 조회)
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
    "status" : "success",
    "data" : [
        // 2. target_email과 요청자가 다를 때 (타인 정보 조회)
        {
            "type" : "USER",
            "email" : "target@gmail.com",
            "name" : "홍길동"
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
| type | String | 필수 | 데이터의 타입 (USER) |
| id | String | 선택 | 데이터 식별 id (본인 조회 시에만 포함) |
| email | String | 필수 | 유저 이메일 |
| name | String | 필수 | 유저 이름 |
| personal_node_id | Integer | 선택 | 개인 공간 노드 id (본인 조회 시에만 포함) |
| created_at | String | 선택 | 유저 가입날짜 (본인 조회 시에만 포함) |
| updated_at | String | 선택 | 데이터의 최신 업데이트 시간 (본인 조회 시에만 포함) |