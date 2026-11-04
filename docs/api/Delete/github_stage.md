# GitHub 파일 스테이징 해제 api
- 스테이징된 파일들을 Git 인덱스에서 제거(언스테이징)하는 api
## Request
- Request syntax
```json
{
    "repo_id": 1,
    "branch": "feature/login",
    "paths": [
        "README.md"
    ]
}
```

| Method | URL |
| :--- | :--- |
| Delete | http://{서버 url}/api/github/repos/stage |

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
| paths | Array | 필수 | 언스테이징할 파일 상대 경로 배열 |

---

## Response
- Response Syntax
```json
{
    "status": "success",
    "data": [
        {
            "path": "src/services/auth.ts",
            "state": "modified",
            "staged": true
        },
        {
            "path": "README.md",
            "state": "modified",
            "staged": false
        }
    ],
    "message": "스테이징을 해제했습니다."
}
```
```json
{
    "status": "error",
    "code": "P0807",
    "message": "스테이징을 해제하지 못했습니다."
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | 언스테이징 후 최신 작업 트리 상태 목록 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. 작업 트리의 파일 내용 자체는 유지되며 인덱스 상태만 언스테이징(`staged: false`)으로 전환됩니다.<br>
