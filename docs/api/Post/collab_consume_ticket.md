# 협업 서버 티켓 검증 및 소비 내부 api
- collab 사이드카 컨테이너가 클라이언트가 제시한 1회용 협업 티켓을 검증하고 세션을 확정하는 내부 전용 api
## Request
- Request syntax
```json
{
    "ticket": "c8a7b6e5d4..."
}
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/internal/collab/tickets/consume |

---
- Request Header

| 파라미터 | 타입 | 필수여부 | 설명 |
| :--- | :--- | :--- | :--- |
| Content_type | String | 필수 | application/json |
| X-Internal-Token | String | 필수 | 서버 컨테이너 간 내부 보안 공유 토큰 (`INTERNAL_TOKEN`) |

---
- Request Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| ticket | String | 필수 | 소비할 1회용 티켓 문자열 |

---

## Response
- Response Syntax
```json
{
    "status": "success",
    "data": [
        {
            "user_email": "user@example.com",
            "user_name": "홍길동",
            "repo_id": 1,
            "node_id": 10,
            "can_write": true
        }
    ],
    "message": "티켓을 확인했습니다."
}
```
```json
{
    "status": "error",
    "code": "P0901",
    "message": "티켓이 만료되었거나 이미 사용되었습니다."
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | 검증된 사용자 및 저장소 권한 정보 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. 외부 인터넷에는 노출되지 않는 내부(사이드카 간) 통신 전용 API입니다.<br>
2. 티켓은 1회 사용 시 즉시 메모리 저장소에서 파기됩니다.<br>
