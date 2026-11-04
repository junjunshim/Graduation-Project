# GitHub 브랜치 목록 조회 api
- 저장소에 등록된 브랜치 목록과 접속자 정보, 원격(origin) 브랜치 목록을 조회하는 api
## Request
- Request syntax
```json
{
}
```

| Method | URL |
| :--- | :--- |
| Get | http://{서버 url}/api/github/repos/branches?repo_id=1 |

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
| repo_id | Integer | 필수 | 저장소 식별 id |

---

## Response
- Response Syntax
```json
{
    "status": "success",
    "data": [
        {
            "name": "main",
            "is_default": true,
            "is_registered": true,
            "presence": [
                {
                    "user_id": "U-1",
                    "user_name": "홍길동",
                    "email": "user@example.com",
                    "client_id": "client-abc",
                    "last_seen_at": "2026-10-15T00:00:00.000000+00:00"
                }
            ]
        },
        {
            "name": "feature/login",
            "is_default": false,
            "is_registered": true,
            "presence": []
        },
        {
            "name": "feature/payment",
            "is_default": false,
            "is_registered": false,
            "presence": []
        }
    ],
    "message": "브랜치 목록을 조회했습니다."
}
```
```json
{
    "status": "error",
    "code": "P0801",
    "message": "연결된 저장소를 찾을 수 없습니다."
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | 브랜치 목록 (기본 브랜치가 최상단 정렬) |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. `is_registered`가 `true`인 브랜치는 서버에 작업 트리(worktree)가 등록되어 협업이 준비된 브랜치입니다.<br>
2. 원격에만 있고 아직 서버에 등록되지 않은 브랜치는 `is_registered: false`로 반환되며, 선택 시 자동 등록됩니다.<br>
3. `presence` 배열에는 현재 해당 브랜치에 WebSocket으로 접속 중인 협업자 목록이 포함됩니다.<br>
