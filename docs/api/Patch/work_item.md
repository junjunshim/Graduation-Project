# work_item 업데이트 api
- 사용자의 work_item을 변경하는 api
## Request
- Request syntax
```json
{
    "work_item_id" : "WI-1101",
    "title" : "테스트 work_item",
    "category" : "BUG",
    "description" : "테스트용 work_item",
    "status" : "todo",
    "priority" : 3,
    "hidden" : false,
    "weight" : 1,
    "progress" : 0,
    "start_date" : "2026-03-01",
    "due_date" : "2026-03-31"
}
```

| Method | URL |
| :--- | :--- |
| Patch | http://{서버 url}/api/workItems |

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
| work_item_id | String | 필수 | 식별용 id |
| title | String | 선택 | work_item 이름 |
| category | String | 선택 | work_item 카테고리 (자유 문자열) |
| description | String | 선택 | work_item 설명 |
| status | String | 선택 | 현재 상태(todo, in_progress, done 등) |
| priority | Integer | 선택 | 우선순위 |
| hidden | Boolean | 선택 | 숨김속성 |
| weight | Integer | 선택 | 가중치 |
| progress | Integer | 선택 | 진행도 |
| start_date | DATE | 선택 | 시작 날짜 |
| due_date | DATE | 선택 | 마감 날짜 |

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
            "category" : "BUG",
            "status" : "todo",
            "priority" : 3,
            "hidden" : false,
            "weight" : 1,
            "progress" : 0,
            "start_date" : "2026-03-01",
            "due_date" : "2026-03-31",
            "updated_at" : "2026-03-19 12:29:24.745634+00"
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
| data | Array | 성공 | 수정된 work_item의 데이터 배열 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 (WORK_ITEM) |
| id | String | 필수 | work_item 식별 id |
| parent_id | String or Null | 선택 | 부모 work_item의 id |
| owner_node_id | Integer | 필수 | 소속 노드 id |
| owner_user_id | String | 필수 | 소유자 id |
| title | String | 필수 | work_item 이름 |
| description | String | 필수 | work_item 설명 |
| category | String or Null | 선택 | work_item 카테고리 |
| status | String | 필수 | work_item 상태 |
| priority | Integer | 필수 | work_item 우선순위 |
| hidden | Boolean | 필수 | 숨김 속성 현황 |
| weight | Integer | 필수 | 가중치 |
| progress | Integer | 필수 | 진행률 |
| start_date | String | 필수 | 시작 날짜 |
| due_date | String | 필수 | 마감 날짜 |
| updated_at | String | 필수 | 데이터의 최신 업데이트 시간 |