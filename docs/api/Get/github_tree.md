# GitHub 저장소 파일 트리 조회 api
- 지정한 브랜치 및 하위 디렉터리 경로의 한 단계 파일/폴더 목록(디렉터리 트리)을 조회하는 api
## Request
- Request syntax
```json
{
}
```

| Method | URL |
| :--- | :--- |
| Get | http://{서버 url}/api/github/repos/tree?repo_id=1&branch=main&path=src |

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
| branch | String | 선택 | 조회할 브랜치명 (생략 시 기본 브랜치) |
| path | String | 선택 | 조회할 디렉터리 상대 경로 (생략 시 루트 디렉터리) |

---

## Response
- Response Syntax
```json
{
    "status": "success",
    "data": [
        {
            "name": "components",
            "path": "src/components",
            "type": "tree",
            "mode": "040000",
            "size": 0
        },
        {
            "name": "index.ts",
            "path": "src/index.ts",
            "type": "blob",
            "mode": "100644",
            "size": 1024
        }
    ],
    "message": "디렉터리 트리를 조회했습니다."
}
```
```json
{
    "status": "error",
    "code": "P0801",
    "message": "브랜치 또는 경로를 찾을 수 없습니다."
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | 해당 경로 하위의 1단계 엔트리 목록 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. 트리 렌더링 성능 최적화를 위해 디렉터리 단위 Lazy 조회를 수행합니다.<br>
2. `type`은 디렉터리인 경우 `tree`, 일반 파일인 경우 `blob`입니다.<br>
