# GitHub 저장소 연결 api
- 특정 조직 노드에 GitHub 원격 저장소를 연결하고 서버 로컬에 clone 및 기본 브랜치를 준비하는 api
## Request
- Request syntax
```json
{
    "node_id": 10,
    "owner_login": "my-org",
    "repo_name": "backend-service",
    "clone_url": "https://github.com/my-org/backend-service.git",
    "default_branch": "main"
}
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/api/github/repos |

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
| node_id | Integer | 필수 | 저장소를 연결할 노드 id |
| owner_login | String | 필수 | GitHub 소유자(조직/사용자) 계정명 |
| repo_name | String | 필수 | GitHub 저장소 이름 |
| clone_url | String | 선택 | HTTPS clone URL (생략 시 owner/repo 기반 자동 구성) |
| default_branch | String | 선택 | 기본 브랜치명 (생략 시 clone 결과 또는 main) |

---

## Response
- Response Syntax
```json
{
    "status": "success",
    "data": [
        {
            "type": "GITHUB_REPOSITORY",
            "repo_id": 1,
            "node_id": 10,
            "owner_login": "my-org",
            "repo_name": "backend-service",
            "clone_url": "https://github.com/my-org/backend-service.git",
            "default_branch": "main",
            "local_path": "repository/10/backend-service",
            "is_deleted": false,
            "created_at": "2026-10-15T00:00:00.000000+00:00",
            "updated_at": "2026-10-15T00:00:00.000000+00:00"
        }
    ],
    "message": "저장소를 연결했습니다."
}
```
```json
{
    "status": "error",
    "code": "P0103",
    "message": "Requester does not have GITHUB_REPO_MANAGE permission on node: 10"
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | 연결된 저장소 메타데이터 목록 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. 노드에 대해 `GITHUB_REPO_MANAGE` 권한(ADMIN 계열)이 필요합니다.<br>
2. 비공개(private) 저장소인 경우 요청자의 GitHub 자격증명(PAT)이 사전에 등록되어 있어야 clone/fetch가 가능합니다.<br>
3. 성공 시 기본 브랜치가 등록된 브랜치로 자동 추가되며 clone 작업 트리가 준비됩니다.<br>
