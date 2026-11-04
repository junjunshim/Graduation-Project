# GitHub 파일 스테이징 api
- 변경된 파일들을 Git 인덱스에 추가(스테이징, `git add`)하는 api
## Request
- Request syntax
```json
{
    "repo_id": 1,
    "branch": "feature/login",
    "paths": [
        "src/services/auth.ts",
        "README.md"
    ]
}
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/api/github/repos/stage |

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
| paths | Array | 필수 | 스테이징할 파일 상대 경로 배열 |

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
            "staged": true
        }
    ],
    "message": "스테이징했습니다."
}
```
```json
{
    "status": "error",
    "code": "P0807",
    "message": "스테이징하지 못했습니다."
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | 스테이징 후 최신 작업 트리 상태 목록 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. 스테이징 수행 전, 협업 세션에서 편집 중인 미반영 메모리 문서(Yjs doc)를 자동으로 먼저 디스크에 내려씁니다(flush).<br>
2. 성공 시 같은 브랜치를 보고 있는 다른 사용자들에게도 상태 변경 알림이 전송됩니다.<br>
