# GitHub 자격증명(PAT) 상태 조회 api
- 현재 사용자의 GitHub 개인 액세스 토큰(PAT) 등록 여부와 계정 정보를 확인하는 api
## Request
- Request syntax
```json
{
}
```

| Method | URL |
| :--- | :--- |
| Get | http://{서버 url}/api/github/credentials |

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
            "github_login": "octocat",
            "has_credential": true,
            "scopes": "repo, read:user",
            "updated_at": "2026-10-15T00:00:00.000000+00:00"
        }
    ],
    "message": "GitHub 자격증명 상태를 조회했습니다."
}
```
```json
{
    "status": "success",
    "data": [
        {
            "user_email": "user@example.com",
            "github_login": null,
            "has_credential": false,
            "scopes": null,
            "updated_at": null
        }
    ],
    "message": "GitHub 자격증명 상태를 조회했습니다."
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | 자격증명 상태 정보 (토큰 값 자체는 보안상 일절 반환되지 않음) |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. 보안을 위해 실제 PAT 토큰 값은 반환하지 않고 등록 여부(`has_credential`) 및 스코프만 반환합니다.<br>
