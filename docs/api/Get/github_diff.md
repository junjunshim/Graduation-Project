# GitHub 변경 파일 목록(Diff Range) 조회 api
- 두 커밋/브랜치 리비전 간에 변경된 파일 목록 및 상태(Diff Range)를 조회하는 api
## Request
- Request syntax
```json
{
}
```

| Method | URL |
| :--- | :--- |
| Get | http://{서버 url}/api/github/repos/diff?repo_id=1&base=main&target=feature/login |

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
| target | String | 필수 | 대상 리비전 (커밋 SHA, 브랜치명 등) |
| base | String | 선택 | 기준 리비전 (생략 시 루트 커밋 빈 트리와 비교) |

---

## Response
- Response Syntax
```json
{
    "status": "success",
    "data": [
        {
            "path": "src/services/auth.ts",
            "state": "renamed",
            "from": "src/utils/auth.ts"
        },
        {
            "path": "src/index.ts",
            "state": "modified"
        },
        {
            "path": "src/types/user.ts",
            "state": "added"
        }
    ],
    "message": "변경 목록을 조회했습니다."
}
```
```json
{
    "status": "error",
    "code": "P0801",
    "message": "그 버전을 찾을 수 없습니다: main"
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | 변경 파일 및 상태 목록 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. `git diff --name-status --find-renames`를 기반으로 파일 목록과 상태(`added`, `modified`, `deleted`, `renamed`, `copied`)를 반환합니다.<br>
2. 파일별 구체적 코드 내용은 `/api/github/repos/file` API에 해당 커밋 SHA를 지정하여 개별 조회합니다.<br>
