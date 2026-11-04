# 협업 브랜치 작업 디렉터리 경로 해석 내부 api
- collab 사이드카 컨테이너가 특정 저장소 및 브랜치의 실제 파일시스템 경로(볼륨 상대 경로)와 Yjs 저장소 경로를 확인하는 내부 api
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
| Post | http://{서버 url}/internal/collab/resolve |

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

---

## Response
- Response Syntax
```json
{
    "status": "success",
    "data": [
        {
            "repo_id": 1,
            "node_id": 10,
            "branch": "feature/login",
            "default_branch": "main",
            "is_default": false,
            "worktree_rel": "10/backend-service.worktrees/feature-login",
            "collab_rel": "10/backend-service.collab/feature-login"
        }
    ],
    "message": "브랜치 작업 디렉터리를 확인했습니다."
}
```
```json
{
    "status": "error",
    "code": "P0801",
    "message": "등록되지 않은 저장소 또는 브랜치입니다: feature/login"
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | 공유 볼륨 상대 경로 정보 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. backend와 collab 컨테이너가 공유 마운트하는 물리 볼륨 기준의 상대 경로(`worktree_rel`, `collab_rel`)를 반환합니다.<br>
