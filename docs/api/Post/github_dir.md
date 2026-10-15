# GitHub 디렉터리 생성 api
- 작업 디렉터리에 새로운 폴더(디렉터리)를 생성하는 api
## Request
- Request syntax
```json
{
    "repo_id": 1,
    "branch": "feature/login",
    "path": "src/services"
}
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/api/github/repos/dirs |

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
| path | String | 필수 | 생성할 디렉터리 상대 경로 |

---

## Response
- Response Syntax
```json
{
    "status": "success",
    "data": [],
    "message": "디렉터리를 만들었습니다."
}
```
```json
{
    "status": "error",
    "code": "P0813",
    "message": "이미 있는 경로입니다: src/services"
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | 작업 트리 변경 상태 목록 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. Git 자체는 빈 디렉터리를 추적하지 않으므로 내부에 파일이 생성되기 전까지는 Git 상태에 나타나지 않을 수 있으나 파일시스템 상에는 즉시 생성됩니다.<br>
2. 성공 시 WebSocket을 통해 `dir_created` 이벤트가 브로드캐스트됩니다.<br>
