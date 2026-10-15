# GitHub 저장소 Fetch api
- 원격 저장소의 최신 참조 및 브랜치 정보를 가져오는(fetch) api
## Request
- Request syntax
```json
{
    "repo_id": 1,
    "branch": "main"
}
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/api/github/repos/fetch |

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
| branch | String | 선택 | 기준 브랜치명 (생략 시 기본 브랜치) |

---

## Response
- Response Syntax
```json
{
    "status": "success",
    "data": [
        {
            "ahead": 0,
            "behind": 2,
            "has_upstream": true
        }
    ],
    "message": "원격 저장소를 최신으로 맞췄습니다."
}
```
```json
{
    "status": "error",
    "code": "P0808",
    "message": "원격 저장소에 접근할 수 없습니다."
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | Fetch 후 원격 대비 동기화 상태 (ahead/behind 카운트) |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. `git fetch --all --prune`을 실행하여 원격 변경 내역을 로컬 ref에 동기화합니다.<br>
2. 요청자의 GitHub PAT 토큰이 등록되어 있으면 비공개 저장소도 인증하여 가져옵니다.<br>
