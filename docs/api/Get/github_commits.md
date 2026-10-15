# GitHub 커밋 내역 조회 api
- 서버 로컬 저장소의 실제 Git 커밋 로그 그래프를 조회하는 api
## Request
- Request syntax
```json
{
}
```

| Method | URL |
| :--- | :--- |
| Get | http://{서버 url}/api/github/repos/commits?repo_id=1&branch=main&limit=50 |

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
| branch | String | 선택 | 조회할 브랜치 (생략 시 기본 브랜치) |
| all | Boolean | 선택 | 전체 브랜치/태그 포함 그래프 조회 여부 (`true` / `false`) |
| limit | Integer | 선택 | 가져올 커밋 개수 (기본값: 50, 최대: 200) |

---

## Response
- Response Syntax
```json
{
    "status": "success",
    "data": [
        {
            "sha": "a1b2c3d4e5f6...",
            "parents": ["f0e9d8c7..."],
            "author_name": "홍길동",
            "author_email": "user@example.com",
            "author_date": "2026-10-15T00:00:00.000000+00:00",
            "message": "WI-101: 로그인 API 연동 작업",
            "refs": ["HEAD -> main", "origin/main"]
        }
    ],
    "message": "커밋 기록을 조회했습니다."
}
```
```json
{
    "status": "error",
    "code": "P0801",
    "message": "브랜치를 찾을 수 없습니다: main"
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | 커밋 상세 목록 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. 서버 로컬 Git 저장소의 log를 직접 조회하므로 별도의 GitHub PAT 토큰 없이도 고속 조회가 가능합니다.<br>
2. `all=true` 옵션을 주면 저장소의 모든 브랜치, 태그, 원격 추적 브랜치가 합쳐진 전체 커밋 그래프가 반환됩니다.<br>
