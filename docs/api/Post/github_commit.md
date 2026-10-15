# GitHub 커밋 api
- 작업 디렉터리의 변경사항을 로컬 Git에 커밋하고 업무(WorkItem)와 자동 연결하는 api
## Request
- Request syntax
```json
{
    "repo_id": 1,
    "branch": "feature/login",
    "message": "WI-101: 로그인 인증 로직 구현",
    "paths": [
        "src/services/auth.ts"
    ],
    "identity": {
        "name": "홍길동"
    }
}
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/api/github/repos/commits |

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
| message | String | 필수 | 커밋 메시지 |
| paths | Array | 선택 | 커밋할 파일 경로 배열 (생략 시 변경사항 전체 커밋) |
| identity | Object | 선택 | 커밋 작성자 부가 정보 (이름 등) |

---

## Response
- Response Syntax
```json
{
    "status": "success",
    "data": [
        {
            "commit_id": 10,
            "repo_id": 1,
            "branch_name": "feature/login",
            "commit_hash": "b2c3d4e5f6a7...",
            "author_email": "user@example.com",
            "message": "WI-101: 로그인 인증 로직 구현",
            "pushed": false,
            "ahead": 1,
            "behind": 0,
            "has_upstream": true,
            "matched_work_item_id": "WI-101",
            "status_transition": {
                "applied": true,
                "work_item_id": "WI-101",
                "from": "todo",
                "to": "in_progress"
            }
        }
    ],
    "message": "커밋했습니다. 원격 전송은 push 로 따로 합니다."
}
```
```json
{
    "status": "error",
    "code": "P0908",
    "message": "협업 서버와 연결하지 못해 커밋하지 않았습니다. 잠시 뒤 다시 시도해 주세요."
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | 생성된 커밋 로그 및 동기화 상태 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. 커밋 수행 전 협업 서버(collab)의 최신 텍스트 버퍼를 강제 flush하여 최신 변경사항을 완전히 포함시킵니다.<br>
2. 커밋 메시지에 `WI-xxx` 패턴이 포함되어 있고 해당 업무가 `todo` 상태라면 `in_progress`로 자동 상태 전환됩니다.<br>
3. 원격 전송(push)은 분리되어 있어 본 API 호출 시점에는 `pushed: false` 상태로 로컬에 기록되며, 원격 전송은 push API를 통해 별도 수행합니다.<br>
4. 커밋 시작 및 완료 시 WebSocket으로 `commit_started`, `commit_finished` 이벤트가 브로드캐스트되어 협업자 간 입력 충돌을 방지합니다.<br>
