# 협업 worktree 변경 통지 내부 api
- collab 사이드카 컨테이너가 문서를 파일시스템에 flush한 직후, C++ 백엔드에게 알려 같은 브랜치 사용자들에게 변경 이벤트를 중계하도록 요청하는 내부 api
## Request
- Request syntax
```json
{
    "repo_id": 1,
    "branch": "feature/login",
    "paths": [
        "src/services/auth.ts"
    ]
}
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/internal/collab/worktree-changed |

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
| repo_id | Integer | 필수 | 저장소 식별 id |
| branch | String | 필수 | 대상 브랜치 이름 |
| paths | Array | 선택 | 변경된 파일 경로 목록 |

---

## Response
- Response Syntax
```json
{
    "status": "success",
    "data": [
        {
            "repo_id": 1,
            "branch": "feature/login",
            "notified": 1
        }
    ],
    "message": "worktree 변경을 알렸습니다."
}
```
```json
{
    "status": "error",
    "code": "401",
    "message": "내부 인증에 실패했습니다."
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | 통지 결과 요약 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. C++ 백엔드는 수신 즉시 같은 브랜치 방의 모든 WebSocket 접속자에게 `worktree_changed` 이벤트를 중계 브로드캐스트합니다.<br>
