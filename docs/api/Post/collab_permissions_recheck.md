# 협업 세션 권한 주기적 재확인 내부 api
- collab 사이드카 컨테이너가 유지 중인 활성 세션들에 대해 권한 변동(역할 변경, 권한 회수, 노드 삭제 등)이 발생했는지 주기적으로 일괄 확인하는 내부 api
## Request
- Request syntax
```json
{
    "sessions": [
        {
            "repo_id": 1,
            "user_email": "user@example.com"
        },
        {
            "repo_id": 1,
            "user_email": "guest@example.com"
        }
    ]
}
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/internal/collab/permissions/recheck |

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
| sessions | Array | 필수 | 권한을 재확인할 세션 객체 배열 (최대 1,000개) |

---

## Response
- Response Syntax
```json
{
    "status": "success",
    "data": [
        {
            "repo_id": 1,
            "user_email": "user@example.com",
            "can_view": true,
            "can_write": true
        },
        {
            "repo_id": 1,
            "user_email": "guest@example.com",
            "can_view": false,
            "can_write": false
        }
    ],
    "message": "세션 권한을 확인했습니다."
}
```
```json
{
    "status": "error",
    "code": "400",
    "message": "필수 파라미터(sessions)가 누락되었습니다."
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | 각 세션별 최신 조회 및 쓰기 권한 상태 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. 권한이 회수되었거나 노드가 삭제된 경우 `can_view: false`가 반환되며, collab 컨테이너는 해당 세션을 즉시 강제 종료합니다.<br>
