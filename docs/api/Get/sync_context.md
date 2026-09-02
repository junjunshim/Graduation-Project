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
            "type" : "WORK_ITEM",
            "id" : "WI-1101",
            "parent_id" : "WI-110",
            "owner_node_id" : 10,
            "owner_user_id" : "U-12",
            "title" : "테스트 work_item",
            "description" : "테스트용 work_item",
            "category" : "FEATURE",
            "status" : "todo",
            "priority" : 3,
            "hidden" : false,
            "weight" : 1,
            "progress" : 0,
            "start_date" : "2026-03-01",
            "due_date" : "2026-03-31",
            "updated_at" : "2026-03-19 12:29:24.745634+00"
        },
        {
            "type" : "WORK_ITEM",
            "id" : "WI-999",
            "status" : "deleted",
            "updated_at" : "2026-03-19 12:35:00.000000+00"
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
            "type" : "ROLE",
            "id" : 15,
            "status" : "deleted",
            "updated_at" : "2026-03-19 12:30:00.000000+00"
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
            "type": "MENTION",
            "id": 15,
            "comment_id": 105,
            "work_item_id": "WI-104",
            "message": "이순신님이 댓글에서 회원님을 멘션했습니다.",
            "is_read": false,
            "created_at": "2026-03-19 12:30:00.000000+00",
            "updated_at": "2026-03-19 12:30:00.000000+00"
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
| data | Array | 성공 | 동기화 시점 이후 변경/추가/삭제된 엔티티(NODE, WORK_ITEM, ROLE, AUTHORITY, MENTION) 배열 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 (NODE, WORK_ITEM, ROLE, AUTHORITY, MENTION) |
| id | String or Integer | 필수 | 데이터 식별 id (NODE/ROLE/AUTHORITY/MENTION: Integer, WORK_ITEM: String) |
| node_type | String | node | 노드의 타입 (신규/수정 시) |
| parent_id | String or Integer or Null | node, work_item | 상위 식별 id (노드는 Integer, 업무는 String) |
| title | String | node, work_item | 노드 이름 또는 업무 제목 |
| path | Array | node | 노드의 계층 경로 배열 |
| owner_node_id | Integer | work_item | 업무 소속 노드 id |
| owner_user_id | String | work_item | 업무 담당자 사용자 id |
| description | String or Null | work_item | 업무 설명 |
| category | String or Null | work_item | 업무 카테고리 |
| status | String | 필수 | 업무 상태 또는 변경 상태 (삭제된 객체인 경우 항상 `"deleted"`) |
| priority | Integer | work_item | 업무 우선순위 |
| hidden | Boolean | work_item | 업무 숨김 여부 |
| weight | Integer | work_item | 업무 가중치 |
| progress | Integer | work_item | 업무 진행률 |
| start_date | String or Null | work_item | 업무 시작 일자 |
| due_date | String or Null | work_item | 업무 마감 일자 |
| node_id | Integer | role, authority | 소속 노드의 id |
| email | String | role | 역할이 배정된 사용자 이메일 |
| role | String | role, authority | 역할 이름 (ADMIN, MANAGER, MEMBER 등) |
| authority | String | authority | 24비트 권한 문자열 |
| comment_id | Integer | mention | 멘션이 발생한 댓글 식별 ID |
| work_item_id | String | mention | 댓글이 작성된 업무 식별 ID |
| message | String | mention | 멘션 알림 메시지 내용 |
| is_read | Boolean | mention | 알림 읽음 상태 여부 |
| created_at | String | mention | 알림 생성 일시 |
| updated_at | String | 필수 | 데이터의 최신 업데이트 시간 |

- 설명<br>
1. context_init api를 통해서 가져온 데이터를 서버 데이터와 동기화하는 api<br>
2. 앱에서 지속적으로 서버로 동기화 요청하여 마지막 동기화 시간 이후에 변경되거나 삭제된 데이터를 가져온다.<br>
3. 삭제된 객체는 `status: "deleted"` 형태로 반환되므로 클라이언트 앱 내부 캐시/상태에서 제거해야 한다.