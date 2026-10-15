# GitHub 브랜치 생성 api
- 저장소에 새 브랜치를 생성하고 서버 작업 디렉터리(worktree)를 준비하는 api
## Request
- Request syntax
```json
{
    "repo_id": 1,
    "name": "feature/login",
    "base_branch": "main"
}
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/api/github/repos/branches |

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
| name | String | 필수 | 생성할 브랜치 이름 |
| base_branch | String | 선택 | 기준 브랜치 (생략 시 기본 브랜치 기준) |

---

## Response
- Response Syntax
```json
{
    "status": "success",
    "data": [
        {
            "type": "GITHUB_BRANCH",
            "branch_id": 5,
            "repo_id": 1,
            "name": "feature/login",
            "base_branch": "main",
            "worktree_path": "repository/10/backend-service.worktrees/feature-login",
            "created_by_email": "user@example.com",
            "is_deleted": false,
            "created_at": "2026-10-15T00:00:00.000000+00:00"
        }
    ],
    "message": "브랜치를 만들었습니다."
}
```
```json
{
    "status": "error",
    "code": "P0103",
    "message": "브랜치 생성 권한(GITHUB_CHANGE)이 없습니다."
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | 생성된 브랜치 정보 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. 노드에 대해 `GITHUB_CHANGE` 권한(MEMBER 이상)이 필요합니다.<br>
2. 브랜치가 성공적으로 생성되면 같은 저장소를 보고 있는 모든 WebSocket 클라이언트에게 `branch_created` 이벤트가 브로드캐스트됩니다.<br>
