# GitHub 커밋 되돌리기(Reset) api
- 현재 브랜치의 마지막 커밋을 취소하거나 원격 브랜치 기준으로 초기화(reset)하는 api
## Request
- Request syntax
```json
{
    "repo_id": 1,
    "branch": "develop",
    "target": "last",
    "mode": "soft"
}
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/api/github/repos/reset |

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
| branch | String | 필수 | 되돌릴 브랜치 이름 |
| target | String | 필수 | `last`(HEAD~1) 또는 `remote`(origin/<branch>) |
| mode | String | 필수 | `soft` · `mixed` · `hard` |

- `target=remote` 는 `mode=hard` 만 허용합니다.

---

## Response
- Response Syntax
```json
{
    "status": "success",
    "data": [
        {
            "action": "reset",
            "target": "last",
            "mode": "soft",
            "old_head_sha": "8f31f1c...",
            "new_head_sha": "4a25d91...",
            "removed_commits": 1,
            "removed_commit_logs": 1,
            "ahead": 0,
            "behind": 0
        }
    ],
    "message": "브랜치를 되돌렸습니다."
}
```
```json
{
    "status": "error",
    "code": "P0818",
    "message": "첫 커밋은 되돌릴 수 없습니다."
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | Reset 후 이전/새 HEAD와 정리된 커밋 수 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |
| action | String | 성공 | `reset` · `up_to_date` |
| target | String | 성공 | `last` · `remote` |
| mode | String | 성공 | `soft` · `mixed` · `hard` |
| removed_commits | Integer | 성공 | 로컬에서 사라진 커밋 수 |
| removed_commit_logs | Integer | 성공 | DB에서 삭제한 미push 커밋 기록 수 |

- 설명<br>
1. `target=last` 는 `HEAD~1` 로 reset합니다. 첫 커밋이면 `P0818` 을 반환합니다.<br>
2. `mode=soft` 는 변경 내용을 staged 상태로, `mixed` 는 작업 트리에 남기고, `hard` 는 추적 파일의 변경을 버립니다.<br>
3. `target=remote` 는 fetch 후 `origin/<branch>` 로 hard reset합니다. 로컬 커밋과 추적 파일의 변경이 사라집니다.<br>
4. hard reset도 untracked 파일은 삭제하지 않습니다.<br>
5. reset으로 사라진 커밋 중 아직 push되지 않은 DB 기록만 정리하고, push된 기록은 원격 이력이므로 유지합니다.<br>
6. hard reset 전에 열린 협업 문서를 파일로 flush하고, reset 후 `branch_synced` WebSocket 이벤트로 Changes와 Graph를 갱신합니다.<br>

