# GitHub 자격증명(PAT) 등록 api
- 사용자의 GitHub 개인 액세스 토큰(Personal Access Token)을 검증하고 암호화하여 등록하는 api
## Request
- Request syntax
```json
{
    "token": "ghp_xxxxxxxxxxxxxxxxxxxx"
}
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/api/github/credentials |

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
| token | String | 필수 | GitHub Personal Access Token (classic 또는 fine-grained) |

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
    "message": "GitHub 자격증명을 등록했습니다."
}
```
```json
{
    "status": "error",
    "code": "P0802",
    "message": "GitHub 토큰이 유효하지 않습니다."
}
```
```json
{
    "status": "error",
    "code": "P0803",
    "message": "'repo' 스코프가 있는 토큰이 필요합니다."
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | 등록된 자격증명 상태 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. 서버는 GitHub REST API(`GET /user`)를 호출하여 토큰의 유효성과 계정명, `repo` 권한 스코프를 검증합니다.<br>
2. 검증된 토큰은 서버 대칭키(`GITHUB_TOKEN_KEY`)로 암호화(pgp_sym_encrypt)되어 안전하게 DB에 저장됩니다.<br>
