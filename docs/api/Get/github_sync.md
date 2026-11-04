# GitHub 동기화 상태(Sync) 조회 api
- 로컬 브랜치가 원격(origin) 브랜치와 비교하여 몇 커밋 앞서거나(ahead) 뒤처졌는지(behind) 조회하는 api
## Request
- Request syntax
```json
{
}
```

| Method | URL |
| :--- | :--- |
| Get | http://{서버 url}/api/github/repos/sync?repo_id=1&branch=main |

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
            "ahead": 1,
            "behind": 0,
            "has_upstream": true
        }
    ],
    "message": "원격 대비 상태를 조회했습니다."
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
| data | Array | 성공 | 동기화 카운트 정보 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. `ahead`: 로컬에는 커밋되었으나 원격에 아직 push되지 않은 커밋 수입니다.<br>
2. `behind`: 원격에는 있으나 로컬에 병합되지 않은 커밋 수입니다.<br>
3. `has_upstream`: 원격 추적 브랜치가 존재하는지 여부입니다.<br>
