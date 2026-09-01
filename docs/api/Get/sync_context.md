# 사용자 데이터 동기화 api
- 사용자의 마지막 업데이트 시점 이후의 변경 데이터를 조회하는 api
## Request
- Request syntax
```json
{
}
```

| Method | URL |
| :--- | :--- |
| Get | http://{서버 url}/api/context/sync?last_synced_at=2026-03-24%2011:10:22 |

---
- Request Header

| 파라미터 | 타입 | 필수여부 | 설명 |
| :--- | :--- | :--- | :--- |
| Content_type | String | 필수 | application/json |
| Authorization | String | 필수 | Bearer 사용자 토큰 | 

---
- Query Parameters

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| last_synced_at | String | 선택 | 마지막 동기화 시점 (YYYY-MM-DD HH:MM:SS), 미입력 시 전체 데이터 반환 |

- Example : `/api/context/sync?last_synced_at=2026-03-24%2011:10:22`

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "data" : [
        {
            "type" : "NODE",
            "id" : 4,
            "node_type" : "DEPARTMENT",
            "parent_id" : 1,
            "title" : "개발 부서",
            "path" : [1, 4],
            "updated_at" : "2026-03-19 12:29:24.745634+00"
        },
        {
            "type" : "WORK_ITEM",
            "id" : "WI-1101",
            "status" : "deleted",
            "updated_at" : "2026-03-19 12:29:24.745634+00"
        },
        {
            "type" : "ROLE",
            "id" : 20,
            "node_id" : 4,
            "email" : "test1234@gmail.com",
            "role" : "ADMIN",
            "updated_at" : "2026-03-19 12:29:24.745634+00"
        },
        {
            "type" : "AUTHORITY",
            "id" : 2,
            "node_id" : 4,
            "role" : "ADMIN",
            "authority" : "011111111111111111111111",
            "updated_at" : "2026-03-19 12:29:24.745634+00"
        },
        {
            "type" : "MENTION",
            "id" : 12,
            "comment_id" : 101,
            "work_item_id" : "WI-1101",
            "message" : "홍길동님이 댓글에서 회원님을 멘션했습니다.",
            "is_read" : true,
            "created_at" : "2026-03-19 12:29:24.745634+00",
            "updated_at" : "2026-03-19 12:35:10.123456+00"
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
| data | Array | 성공 | 조회된 모든 변경 데이터를 담은 배열 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 (NODE, WORK_ITEM, ROLE, AUTHORITY, MENTION) |
| id | String or Integer | 필수 | 데이터 식별 id (NODE/ROLE/AUTHORITY/MENTION은 Integer, WORK_ITEM은 String) |
| node_type | String | node | 노드의 타입 |
| parent_id | Integer or String | node or work_item | 상위 노드 id or 상위 work_item id |
| title | String | node or work_item | 노드의 이름 or work_item 제목 |
| path | Array | node | 노드의 트리구조 |
| owner_node_id | Integer | work_item | 소속 노드 id |
| owner_user_id | String | work_item | 소유자 id |
| description | String | work_item | work_item 설명 |
| status | String | work_item or deleted | work_item 상태 (생성/수정 시 상태값, 삭제 시 "deleted") |
| priority | Integer | work_item | work_item 우선순위 |
| hidden | Boolean | work_item | 숨김 속성 현황 |
| weight | Integer | work_item | 가중치 |
| progress | Integer | work_item | 진행률 |
| start_date | String | work_item | 시작 날짜 |
| due_date | String | work_item | 마감 날짜 |
| node_id | Integer | role or authority | 소속 노드의 id |
| email | String | role | 역할이 배정된 인원 |
| role | String | role or authority | 배정된 역할 이름 |
| authority | String | authority | 역할의 권한 비트 |
| comment_id | Integer | mention | 멘션이 포함된 댓글 id |
| work_item_id | String | mention | 멘션이 발생한 work_item id |
| message | String | mention | 멘션 알림 메시지 |
| is_read | Boolean | mention | 읽음 상태 여부 |
| created_at | String | mention | 알림 생성 일시 |
| updated_at | String | 필수 | 데이터의 최신 업데이트 시간 |

- 설명<br>
1. context_init api를 통해서 가져온 데이터를 서버 데이터와 동기화하는 api<br>
2. 앱에서 지속적으로 서버로 동기화 요청하여 마지막 동기화 시간 이후에 변경되거나 삭제된 데이터를 가져온다.<br>
3. 삭제된 객체는 `status: "deleted"` 형태로 반환되므로 클라이언트 앱 내부 캐시/상태에서 제거해야 한다.