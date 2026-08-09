# 로그인 및 토큰 발급 api
- email 과 password를 통하여 사용자 검증 후, 토큰을 발급하는 api
## Request
- Request syntax
```json
{
    "email" : "admin@gmail.com",
    "password" : "admin@123"
}
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/api/users/login |

---
- Request Header

| 파라미터 | 타입 | 필수여부 | 설명 |
| :--- | :--- | :--- | :--- |
| Content_type | String | 필수 | application/json |

---
- Request Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| email | String | 필수 | 유저 식별용 email |
| password | String | 필수 | 유저 식별용 password |

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "message" : "로그인 성공",
    "access_token" : "토큰",
    "refresh_token" : "토큰"
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
| message | String | 성공/에러 | 요청 관련 메세지 |
| access_token | String | 성공 | 발급된 access_token |
| refresh_token | String | 성공 | 발급된 refresh_token |

- 설명<br>
1. access_token은 클라이언트에서 저장하여 서버요청 시, 헤더에 항상 포함할것<br>
2. refresh_token은 access_token 만료 시, 사용되는 토큰 값