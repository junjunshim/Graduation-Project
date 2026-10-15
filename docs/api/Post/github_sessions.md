# VSCode 확장 세션 토큰 교환 api
- 1회용 핸드오프 코드를 검증하고 VSCode 확장 전용 액세스 토큰 및 리프레시 토큰을 발급하는 api
## Request
- Request syntax
```json
{
    "code": "e9a0c1b2..."
}
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/api/github/sessions |

---
- Request Header

| 파라미터 | 타입 | 필수여부 | 설명 |
| :--- | :--- | :--- | :--- |
| Content_type | String | 필수 | application/json |

---
- Request Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| code | String | 필수 | 1회용 핸드오프 코드 |

---

## Response
- Response Syntax
```json
{
    "status": "success",
    "data": [
        {
            "access_token": "eyJhbGciOi...",
            "refresh_token": "rf_9a8b7c...",
            "expires_in": 3600,
            "user_email": "user@example.com",
            "user_name": "홍길동",
            "node_id": 10,
            "repo_id": 1
        }
    ],
    "message": "확장 세션을 발급했습니다."
}
```
```json
{
    "status": "error",
    "code": "P0811",
    "message": "확장 연결 코드가 유효하지 않거나 만료되었습니다. 앱에서 다시 시도해 주세요."
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | 확장 인증 토큰 및 컨텍스트 정보 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. 확장이 처음 토큰을 수령하는 경로이므로 Authorization 헤더가 필요하지 않습니다.<br>
2. 발급된 리프레시 토큰은 클라이언트 앱 세션과 상호 간섭하지 않도록 확장 전용 테이블에 격리되어 관리됩니다.<br>
