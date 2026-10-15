# GitHub 파일 이름 변경 및 이동 api
- 작업 디렉터리의 파일 또는 폴더 경로를 변경하거나 이동하는 api
## Request
- Request syntax
```json
{
    "repo_id": 1,
    "branch": "feature/login",
    "from": "src/utils/auth.ts",
    "to": "src/services/auth.ts"
}
```

| Method | URL |
| :--- | :--- |
| Patch | http://{서버 url}/api/github/repos/files |

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
| from | String | 필수 | 기존 파일/폴더 상대 경로 |
| to | String | 필수 | 변경할 새 파일/폴더 상대 경로 |

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
            "from": "src/utils/auth.ts",
            "staged": true
        }
    ],
    "message": "이름을 바꿨습니다."
}
```
```json
{
    "status": "error",
    "code": "P0814",
    "message": "경로를 찾을 수 없습니다: src/utils/auth.ts"
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | 변경 후 작업 트리 상태 목록 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. Git 추적 대상인 경우 `git mv`를 통해 인덱스와 함께 원자적으로 이동 처리됩니다.<br>
2. 실시간 협업 세션에서 열려 있던 이전 문서 캐시(Yjs doc)는 자동 정리되며 새 경로로 갱신됩니다.<br>
3. 성공 시 WebSocket을 통해 `file_moved` 이벤트가 브로드캐스트됩니다.<br>
