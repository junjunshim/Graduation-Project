# GitHub 자격증명(PAT) 연결 해제 api
- 등록된 사용자의 GitHub 개인 액세스 토큰을 삭제하고 연결을 해제하는 api
## Request
- Request syntax
```json
{
}
```

| Method | URL |
| :--- | :--- |
| Delete | http://{서버 url}/api/github/credentials |

---
- Request Header

| 파라미터 | 타입 | 필수여부 | 설명 |
| :--- | :--- | :--- | :--- |
| Content_type | String | 필수 | application/json |
| Authorization | String | 필수 | Bearer 사용자 토큰 |

---

## Response
- Response Syntax
```json
{
    "status": "success",
    "data": [
        {
            "user_email": "user@example.com",
            "has_credential": false,
            "is_deleted": true,
            "updated_at": "2026-10-15T00:00:00.000000+00:00"
        }
    ],
    "message": "GitHub 자격증명 연결을 해제했습니다."
}
```
```json
{
    "status": "error",
    "code": "500",
    "message": "서버 내부 오류가 발생했습니다."
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | 연결 해제된 자격증명 상태 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. 사용자의 암호화된 토큰 데이터가 폐기 및 소프트 삭제 처리됩니다.<br>
