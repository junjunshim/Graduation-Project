# VSCode 확장 핸드오프 코드 생성 api
- 데스크톱 앱에서 VSCode 확장(Extension)으로 인증 및 작업 세션을 안전하게 인계하기 위한 1회용 핸드오프 코드를 발급하는 api
## Request
- Request syntax
```json
{
    "node_id": 10,
    "repo_id": 1
}
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/api/github/handoff |

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
| node_id | Integer | 필수 | 작업 노드 id |
| repo_id | Integer | 필수 | 대상 저장소 id |

---

## Response
- Response Syntax
```json
{
    "status": "success",
    "data": [
        {
            "code": "e9a0c1b2...",
            "expires_in": 60,
            "expires_at": "2026-10-15T00:01:00.000000+00:00"
        }
    ],
    "message": "확장에서 사용할 1회용 코드를 발급했습니다."
}
```
```json
{
    "status": "error",
    "code": "P0801",
    "message": "해당 노드에 연결된 저장소를 찾을 수 없습니다."
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 여부 |
| data | Array | 성공 | 1회용 핸드오프 코드 및 만료 시간 |
| message | String | 성공/에러 | 요청 관련 메시지 |
| code | String | 에러 | 에러 코드 |

- 설명<br>
1. 실제 JWT 토큰을 커스텀 URI(`vscode://...`)에 노출하지 않기 위해 1회용 난수 코드(TTL: 60초)를 발급합니다.<br>
2. VSCode 확장은 이 코드를 수신한 뒤 세션 교환 API(`/api/github/sessions`)를 호출하여 전용 토큰을 발급받습니다.<br>
