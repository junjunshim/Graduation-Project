# GitHub 파일 삭제 api
- 작업 디렉터리의 파일 또는 폴더를 삭제하는 api
## Request
- Request syntax
```json
{
    "repo_id": 1,
    "branch": "feature/login",
    "path": "src/services/auth.ts",
    "force": false
}
```

| Method | URL |
| :--- | :--- |
| Delete | http://{서버 url}/api/github/repos/files |

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
| branch | String | 필수 | 대상 브랜치 이름 |
| path | String | 필수 | 삭제할 파일/폴더 상대 경로 |
| force | Boolean | 선택 | 미커밋 수정사항 무시 강제 삭제 여부 (기본값: false) |

---

## Response
- Response Syntax
```json
{
    "status": "success",
    "data": [],
    "message": "삭제했습니다."
}
```
```json
{
    "status": "error",
    "code": "P0810",
    "message": "이 경로에 커밋되지 않은 변경 1개가 있습니다. 삭제하면 함께 사라집니다. 확인해 주세요."
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
1. 해당 파일/폴더에 커밋되지 않은 변경사항이 있으면 손실 방지를 위해 거부(`P0810`)되며, 강제 삭제하려면 `force: true`를 전달해야 합니다.<br>
2. Git 추적 파일인 경우 `git rm` 처리되어 인덱스에서도 삭제 상태로 반영됩니다.<br>
3. 성공 시 WebSocket을 통해 `file_deleted` 이벤트가 브로드캐스트됩니다.<br>
