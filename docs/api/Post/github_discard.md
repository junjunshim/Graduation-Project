# GitHub 변경사항 되돌리기 api
- 수정한 파일의 변경 내용을 취소하고 직전 커밋(HEAD) 상태로 되돌리거나 신규 파일을 삭제하는 api
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
| Post | http://{서버 url}/api/github/repos/discard |

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
| paths | Array | 필수 | 되돌릴 파일 상대 경로 배열 |

---

## Response
- Response Syntax
```json
{
    "status": "success",
    "data": [],
    "message": "변경 사항을 되돌렸습니다."
}
```
```json
{
    "status": "error",
    "code": "P0807",
    "message": "되돌리지 못했습니다."
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | 되돌리기 후 최신 작업 트리 상태 목록 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. 되돌린 변경사항은 복구할 수 없으므로 주의해야 합니다.<br>
2. HEAD에 존재하는 파일은 `git restore`로 복원되며, HEAD에 없던 새로 추가된 파일은 파일시스템에서 완전히 삭제됩니다.<br>
3. 협업 세션(collab)의 메모리 버퍼 doc도 원래 커밋 시점 내용으로 즉시 동기화됩니다.<br>
