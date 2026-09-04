# 회원가입 api
- 회원생성 api
## Request
- Request syntax
```json
{
    "user_id" : "U-100",
    "email" : "test123@gmail.com",
    "name" : "테스터",
    "password" : "test!@2211"
}
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/api/users |

---
- Request Header

| 파라미터 | 타입 | 필수여부 | 설명 |
| :--- | :--- | :--- | :--- |
| Content_type | String | 필수 | application/json |

---
- Request Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| user_id | String | 필수 | 유저 식별 id |
| email | String | 필수 | 유저 이메일 |
| name | String | 필수 | 유저 이름 |
| password | String | 필수 | 비밀번호 |

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "message" : "User registered successfully"
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
| message | String | 필수 | 요청 관련 메세지 |

- 설명<br>
1. 중복된 `user_id`로 요청 시 400 Bad Request와 함께 `"이미 존재하는 아이디입니다."` 에러 메시지 반환 (`[P0510]`)<br>
2. 중복된 `email`로 요청 시 400 Bad Request와 함께 `"이미 존재하는 이메일입니다."` 에러 메시지 반환 (`[P0501]`)

