# GitHub 브랜치 삭제 api
- 등록된 브랜치를 삭제(소프트 삭제 및 worktree 해제)하는 api
## Request
- Request syntax
```json
{
    "repo_id": 1,
    "name": "feature/login",
    "force": false
}
```

| Method | URL |
| :--- | :--- |
| Delete | http://{서버 url}/api/github/repos/branches |

---
- Request Header

| 파라미터 | 타입 | 필수여부 | 설명 |
| :--- | :--- | :--- | :--- |
| Content_type | String | 필수 | application/json |
| Authorization | String | 필수 | Bearer 사용자 토큰 |

---
- Request Elements (또는 Query Parameters 지원)

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| repo_id | Integer | 필수 | 저장소 식별 id |
| name | String | 필수 | 삭제할 브랜치 이름 |
| force | Boolean | 선택 | 미커밋 변경사항 무시 강제 삭제 여부 (기본값: false) |

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
            "is_deleted": true,
            "updated_at": "2026-10-15T00:00:00.000000+00:00"
        }
    ],
    "message": "브랜치를 삭제했습니다."
}
```
```json
{
    "status": "error",
    "code": "P0809",
    "message": "현재 다른 사용자가 접속 중인 브랜치는 삭제할 수 없습니다."
}
```
```json
{
    "status": "error",
    "code": "P0810",
    "message": "커밋되지 않은 변경 사항이 있습니다. 확인해 주세요."
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | 삭제 처리된 브랜치 정보 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. 기본 브랜치는 삭제할 수 없습니다.<br>
2. 브랜치에 현재 접속 중인 사용자가 있으면 삭제할 수 없습니다(force로도 삭제 불가).<br>
3. 커밋되지 않은 변경사항이 있는 경우 `force: true`를 지정해야 삭제가 진행됩니다.<br>
4. 성공 시 WebSocket 클라이언트에게 `branch_deleted` 이벤트가 브로드캐스트됩니다.<br>
