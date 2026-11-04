# GitHub 저장소 목록 조회 api
- 특정 노드에 연결된 활성 GitHub 저장소 목록을 조회하는 api
## Request
- Request syntax
```json
{
}
```

| Method | URL |
| :--- | :--- |
| Get | http://{서버 url}/api/github/repos?node_id=10 |

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
| node_id | Integer | 필수 | 저장소 목록을 조회할 노드 id |

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
    "message": "저장소 목록을 조회했습니다."
}
```
```json
{
    "status": "error",
    "code": "P0103",
    "message": "해당 노드에 대한 조회 권한이 없습니다."
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | 노드에 연결된 저장소 메타데이터 목록 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. 요청자가 해당 노드에 대해 보기 권한(`VIEWER` 이상)이 있어야 합니다.<br>
