# work_item 복구 api
- 휴지통(삭제 상태)에 있는 특정 work_item을 복구하는 api
## Request
- Request Syntax
```json
{
    "work_item_id" : "WI-104",
    "parent_id" : "WI-100",
    "cascade" : false
}
```

| Method | URL |
| :--- | :--- |
| Patch | http://{서버 url}/api/workItems/restore |

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
| work_item_id | String | 필수 | 복구할 대상 work_item 식별 id |
| parent_id | String | 선택 | 새로 지정할 상위 부모 업무 ID (미지정 시 기존 부모 유지) |
| cascade | Boolean | 선택 | 하위 업무 및 소속 파일 일괄 복구 여부 (기본값: false) |

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "data" : [
        {
            "type" : "WORK_ITEM",
            "id" : "WI-104",
            "parent_id" : "WI-100",
            "owner_node_id" : 98,
            "owner_user_id" : "U-163",
            "title" : "세부 화면 설계",
            "description" : "Figma 컴포넌트 세부 디자인",
            "category" : "FEATURE",
            "status" : "todo",
            "priority" : 3,
            "hidden" : false,
            "weight" : 1,
            "progress" : 0,
            "comment_count" : 2,
            "is_deleted" : false,
            "start_date" : "2026-03-01",
            "due_date" : "2026-03-31",
            "updated_at" : "2026-09-02T11:42:00+00:00"
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
| data | Array | 성공 | 복구된 work_item 데이터 리스트 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 (WORK_ITEM) |
| id | String | 필수 | 업무 식별 id |
| parent_id | String or Null | work_item | 상위 부모 업무 식별 id |
| owner_node_id | Integer | work_item | 업무 소속 노드 id |
| owner_user_id | String | work_item | 업무 담당자 사용자 id |
| title | String | work_item | 업무 제목 |
| description | String or Null | work_item | 업무 설명 |
| category | String or Null | work_item | 업무 카테고리 |
| status | String | work_item | 업무 상태값 |
| priority | Integer | work_item | 업무 우선순위 |
| hidden | Boolean | work_item | 업무 숨김 여부 |
| weight | Integer | work_item | 업무 가중치 |
| progress | Integer | work_item | 업무 진행률 |
| comment_count | Integer | work_item | 업무 댓글 수 |
| is_deleted | Boolean | work_item | 삭제 여부 (false) |
| start_date | String or Null | work_item | 업무 시작 일자 |
| due_date | String or Null | work_item | 업무 마감 일자 |
| updated_at | String | work_item | 복구 일시 |
