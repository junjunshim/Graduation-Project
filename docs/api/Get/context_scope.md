# 워크스페이스 스코프 조회 api
- 워크스페이스 진입점 화면용 경량 스코프 조회 api
- 사용자가 접근 가능한 노드 목록(NODE)과 각 노드의 역할(ROLE), 역할별 권한 정의(AUTHORITY)만 가볍게 조회합니다. (업무/파일/활동 제외)
- 진입 화면에서 전체 컨텍스트를 받는 부담을 줄이기 위한 용도로, 조직 구조를 그리는 데 필요한 최소 데이터만 반환합니다.
## Request
- Request syntax
```json
{
}
```

| Method | URL |
| :--- | :--- |
| Get | http://{서버 url}/api/context/scope |

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
| (없음) | - | - | 별도 파라미터 없음 (토큰의 사용자를 기준으로 스코프 계산) |

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "server_time" : "2026-09-16 09:12:00.000000+00",
    "data" : [
        {
            "type" : "NODE",
            "id" : 98,
            "node_type" : "DEPARTMENT",
            "parent_id" : 96,
            "title" : "애플 기획부",
            "path" : [96, 98],
            "is_deleted" : false,
            "created_at" : "2026-09-02T08:54:49.604005Z",
            "updated_at" : "2026-09-02T08:54:49.604005Z"
        },
        {
            "type" : "ROLE",
            "id" : 209,
            "node_id" : 98,
            "user_id" : "U-163",
            "email" : "apple_1dept_leader@apple.com",
            "user_name" : "애플 기획부 팀장",
            "role" : "ADMIN",
            "role_id" : 34,
            "is_top_role" : false,
            "updated_at" : "2026-09-02T08:54:49.604005Z"
        },
        {
            "type" : "AUTHORITY",
            "id" : 389,
            "role_id" : 389,
            "is_top_role" : false,
            "node_id" : 98,
            "role" : "ADMIN",
            "authority" : "011111111111111111111111",
            "updated_at" : "2026-09-02T08:54:49.604005Z"
        }
    ]
}
```
```json
{
    "status" : "error",
    "message" : {에러 메세지}
}
```

- Response Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 |
| server_time | String | 성공 | 서버의 현재 시간 |
| data | Array | 성공 | 접근 가능한 노드(NODE), 역할(ROLE), 권한 정의(AUTHORITY) 통합 리스트 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 (NODE, ROLE, AUTHORITY) |
| id | Integer | 필수 | 데이터 식별 id (NODE: node_id, ROLE: assignment_id, AUTHORITY: authority_id) |
| node_type | String | node | 노드의 타입 |
| parent_id | Integer or Null | node | 상위 노드 id (최상위 노드는 null) |
| title | String | node | 노드 이름 |
| path | Array | node | 노드의 계층 경로 배열 |
| is_deleted | Boolean | node | 노드 삭제 여부 |
| node_id | Integer | role, authority | 소속 노드 id |
| user_id | String | role | 역할이 배정된 사용자 id |
| email | String | role | 역할이 배정된 사용자 이메일 |
| user_name | String | role | 역할이 배정된 사용자 이름 |
| role | String | role, authority | 역할 이름 (ADMIN, MANAGER, MEMBER 등) |
| role_id | Integer | role, authority | 역할 정의 id |
| is_top_role | Boolean | role, authority | 최상위 역할 여부 |
| authority | String | authority | 24비트 권한 문자열 |
| created_at | String | node | 노드 생성 일시 |
| updated_at | String | 필수 | 데이터의 최신 업데이트 시간 |

- 설명<br>
1. 스코프는 JWT 사용자 기준으로 직접 배정 노드 + 하위 노드(NODE_SUB_VIEW) + 상위 노드(NODE_PARENT_VIEW)를 합집합으로 계산한 뒤 DENY 비트가 설정된 노드를 제외해 결정됩니다.<br>
2. ROLE은 멤버 열람 권한(NODE_MEMBERS_VIEW)이 있거나 본인의 역할인 경우에만 반환됩니다.<br>
3. AUTHORITY는 멤버 열람 권한이 있거나 본인 역할의 정의인 경우에만 반환됩니다. authority 값은 24비트 문자열입니다.<br>
4. 사용자가 존재하지 않으면 404와 `요청자를 찾을 수 없습니다.` 메시지가 반환되고, 스코프 계산 중 오류가 나면 500과 `워크스페이스 스코프를 불러오지 못했습니다.` 메시지가 반환됩니다.<br>
