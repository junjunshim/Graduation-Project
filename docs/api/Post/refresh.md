# 토큰 재발급 api
- Refresh Token을 사용하여 새로운 Access Token과 Refresh Token을 발급받는 api
## Request
- Request syntax
```json
{
    "refresh_token" : "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/api/users/refresh |

---
- Request Header

| 파라미터 | 타입 | 필수여부 | 설명 |
| :--- | :--- | :--- | :--- |
| Content_type | String | 필수 | application/json |

---
- Request Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| refresh_token | String | 필수 | 만료되지 않은 Refresh Token |

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "access_token" : "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "refresh_token" : "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
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
| access_token | String | 성공 | 새로 발급된 Access Token |
| refresh_token | String | 성공 | 새로 갱신된 Refresh Token |
| message | String | 에러 | 요청 관련 메세지 |
