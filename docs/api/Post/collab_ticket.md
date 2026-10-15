# 실시간 협업 세션 티켓 발급 api
- 클라이언트/VSCode 확장이 실시간 문서 협업 서버(collab sidecar) WebSocket에 접속하기 위한 1회용 티켓을 발급하는 api
## Request
- Request syntax
```json
{
    "repo_id": 1
}
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/api/collab/tickets |

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
| repo_id | Integer | 필수 | 저장소 식별 id |

---

## Response
- Response Syntax
```json
{
    "status": "success",
    "data": [
        {
            "ticket": "c8a7b6e5d4...",
            "repo_id": 1,
            "node_id": 10,
            "expires_in": 60,
            "expires_at": "2026-10-15T00:01:00.000000+00:00",
            "can_write": true
        }
    ],
    "message": "협업 티켓을 발급했습니다."
}
```
```json
{
    "status": "error",
    "code": "P0801",
    "message": "연결된 저장소를 찾을 수 없습니다."
}
```
```json
{
    "status": "error",
    "code": "P0815",
    "message": "워크스페이스가 삭제되어 협업 세션을 열 수 없습니다."
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | 협업 티켓 및 쓰기 권한 정보 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. 티켓은 1회용이며 유효 시간은 60초(TTL)입니다.<br>
2. 클라이언트는 이 티켓을 사용하여 `wss://<host>/collab/?ticket=<ticket>` 형태로 collab 사이드카 컨테이너에 직접 접속합니다.<br>
3. `can_write`는 사용자의 권한(`GITHUB_CHANGE`)에 따라 결정되며, VIEWER 권한 사용자는 읽기 전용(`can_write: false`) 티켓을 받습니다.<br>
