# VSCode 확장 세션 토큰 갱신 api
- 확장 전용 리프레시 토큰을 검증하고 새로운 액세스/리프레시 토큰을 재발급(토큰 회전)하는 api
## Request
- Request syntax
```json
{
    "refresh_token": "rf_9a8b7c..."
}
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/api/github/sessions/refresh |

---
- Request Header

| 파라미터 | 타입 | 필수여부 | 설명 |
| :--- | :--- | :--- | :--- |
| Content_type | String | 필수 | application/json |

---
- Request Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| refresh_token | String | 필수 | 확장 전용 리프레시 토큰 |

---

## Response
- Response Syntax
```json
{
    "status": "success",
    "data": [
        {
            "access_token": "eyJhbGciOi...",
            "refresh_token": "rf_new123...",
            "expires_in": 3600,
            "user_email": "user@example.com",
            "expires_at": "2026-10-22T00:00:00.000000+00:00"
        }
    ],
    "message": "확장 세션을 갱신했습니다."
}
```
```json
{
    "status": "error",
    "code": "P0812",
    "message": "확장 세션이 만료되었습니다. 앱에서 다시 연결해 주세요."
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | 갱신된 토큰 세트 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. 갱신 요청 시 기존 리프레시 토큰은 파기되고 새로운 리프레시 토큰이 회전(Rotation) 발급됩니다.<br>
