# GitHub 브랜치별 접속자 조회 api
- 저장소 내 각 브랜치에 현재 접속 중인 실시간 사용자(presence) 목록을 조회하는 api
## Request
- Request syntax
```json
{
}
```

| Method | URL |
| :--- | :--- |
| Get | http://{서버 url}/api/github/repos/presence?repo_id=1 |

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
            "presence": []
        }
    ],
    "message": "브랜치별 접속자를 조회했습니다."
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
| data | Array | 성공 | 브랜치별 접속자 현황 목록 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. WebSocket 제어 소켓을 통해 브랜치에 입장한 활성 협업자 세션을 확인할 수 있습니다.<br>
