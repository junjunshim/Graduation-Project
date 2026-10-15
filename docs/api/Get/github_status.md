# GitHub 작업 트리 상태 조회 api
- 브랜치의 작업 디렉터리 내 변경된 파일 및 스테이징 상태(status)를 조회하는 api
## Request
- Request syntax
```json
{
}
```

| Method | URL |
| :--- | :--- |
| Get | http://{서버 url}/api/github/repos/status?repo_id=1&branch=feature/login |

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
    "message": "작업 트리 상태를 조회했습니다."
}
```
```json
{
    "status": "error",
    "code": "P0801",
    "message": "연결된 저장소를 찾을 수 없습니다."
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | 작업 트리 파일별 변경 상태 목록 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. 커밋 직전 Staged 및 Unstaged(Changes) 파일 목록을 파악하는 데 사용됩니다.<br>
2. `staged: true`는 Git 인덱스에 올라간 항목이며, `false`는 작업 트리에만 수정이 존재하는 항목입니다.<br>
