# GitHub 파일 생성 api
- 작업 디렉터리에 새로운 빈 파일을 생성하고 변경 상태를 감지(intent-to-add)하는 api
## Request
- Request syntax
```json
{
    "repo_id": 1,
    "branch": "feature/login",
    "path": "src/utils/auth.ts"
}
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/api/github/repos/files |

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
| path | String | 필수 | 생성할 파일 상대 경로 |

---

## Response
- Response Syntax
```json
{
    "status": "success",
    "data": [
        {
            "path": "src/utils/auth.ts",
            "state": "added",
            "staged": false
        }
    ],
    "message": "파일을 만들었습니다."
}
```
```json
{
    "status": "error",
    "code": "P0813",
    "message": "이미 있는 경로입니다: src/utils/auth.ts"
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | 갱신된 작업 트리 변경 상태 목록 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. 상위 디렉터리가 없으면 자동으로 함께 생성됩니다.<br>
2. `git add -N`이 실행되어 인덱스에 변경 의도가 등록되며, Git 상태에서 '추가(added)'로 표시됩니다.<br>
3. 성공 시 WebSocket을 통해 `file_created` 및 작업 트리 상태 변경 이벤트가 브로드캐스트됩니다.<br>
