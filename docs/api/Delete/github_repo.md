# GitHub 저장소 연결 해제 api
- 노드와 GitHub 저장소 간 연결을 해제(소프트 삭제)하는 api
## Request
- Request syntax
```json
{
}
```

| Method | URL |
| :--- | :--- |
| Delete | http://{서버 url}/api/github/repos?repo_id=1 |

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
| repo_id | Integer | 필수 | 연결을 해제할 저장소 식별 id |

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
            "is_deleted": true,
            "updated_at": "2026-10-15T00:00:00.000000+00:00"
        }
    ],
    "message": "저장소 연결을 해제했습니다."
}
```
```json
{
    "status": "error",
    "code": "P0103",
    "message": "저장소 관리 권한이 없습니다."
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | 삭제 처리된 저장소 데이터 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. 노드에 대해 `GITHUB_REPO_MANAGE` 권한이 필요합니다.<br>
2. 저장소의 실제 디렉터리 사본은 즉시 삭제되지 않고 소프트 삭제되며, 재연결 시 재사용할 수 있습니다.<br>
