# GitHub 저장소 Pull api
- 원격 저장소를 fetch 한 뒤 현재 브랜치에 원격 변경을 병합(pull)하는 api
## Request
- Request syntax
```json
{
    "repo_id": 1,
    "branch": "develop"
}
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/api/github/repos/pull |

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
| branch | String | 필수 | 병합할 브랜치 이름 |

---

## Response
- Response Syntax
```json
{
    "status": "success",
    "data": [
        {
            "action": "fast_forward",
            "changed_paths": 3,
            "has_upstream": true,
            "head_sha": "8f31f1c...",
            "origin_sha": "8f31f1c...",
            "ahead": 0,
            "behind": 0
        }
    ],
    "message": "원격 변경을 fast-forward 했습니다."
}
```
```json
{
    "status": "error",
    "code": "P0810",
    "message": "커밋되지 않은 변경이 있어 원격 변경을 병합하지 않았습니다. 먼저 커밋하거나 되돌려 주세요."
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | Pull 후 동기화 상태와 처리 결과 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |
| action | String | 성공 | `fast_forward` · `merged` · `up_to_date` |
| changed_paths | Integer | 성공 | 병합으로 바뀐 경로 수 |
| head_sha | String | 성공 | 병합 후 로컬 HEAD |
| origin_sha | String | 성공 | 원격 추적 브랜치 SHA |
| ahead | Integer | 성공 | merge/pull 후 push 할 커밋 수 |
| behind | Integer | 성공 | 남은 원격 커밋 수 |

- 설명<br>
1. `git fetch --all --prune` 으로 원격 추적 ref를 먼저 갱신합니다.<br>
2. 커밋되지 않은 변경이 있으면 다른 사용자의 변경과 섞이지 않도록 `P0810` 으로 거부합니다.<br>
3. 원격이 앞서 있고 로컬에만 있는 커밋이 없으면 fast-forward, 양쪽에 커밋이 있으면 merge commit을 만듭니다.<br>
4. 병합 충돌 시 `git merge --abort` 로 작업 트리를 원래대로 되돌리고 충돌 경로와 함께 `P0817` 을 반환합니다.<br>
5. 성공 시 열려 있는 협업 문서를 병합 결과로 맞추고 `branch_synced` WebSocket 이벤트를 브로드캐스트합니다.<br>

