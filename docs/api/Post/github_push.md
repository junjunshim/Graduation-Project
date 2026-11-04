# GitHub Push api
- 로컬에 커밋된 내역들을 GitHub 원격 저장소로 업로드(push)하는 api
## Request
- Request syntax
```json
{
    "repo_id": 1,
    "branch": "feature/login"
}
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/api/github/repos/push |

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
| branch | String | 필수 | 대상 브랜치 이름 |

---

## Response
- Response Syntax
```json
{
    "status": "success",
    "data": [
        {
            "ahead": 0,
            "behind": 0,
            "has_upstream": true,
            "pushed": true,
            "pushed_commit_count": 1
        }
    ],
    "message": "원격에 push 했습니다."
}
```
```json
{
    "status": "error",
    "code": "P0802",
    "message": "GitHub 자격증명이 없어 push 하지 못했습니다."
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | Push 후 동기화 상태 및 반영된 커밋 수 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. push 작업은 요청자의 개인 PAT 자격증명을 사용하여 원격 저장소로 인증/전송됩니다.<br>
2. 성공 시 데이터베이스의 해당 브랜치 커밋 로그 상태가 `pushed: true`로 갱신됩니다.<br>
3. 성공 시 WebSocket을 통해 `push_finished` 이벤트가 브로드캐스트됩니다.<br>
