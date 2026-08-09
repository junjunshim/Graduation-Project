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
| Get | http://{서버 url}/api/context/sync |

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
| last_synced_at | String | 필수 | 마지막 동기화 시점 (YYYY-MM-DD HH:MM:SS), 미입력 시 전체 데이터를 반환|

- Example : /api/context/sync?last_synced_at=2026-03-24%2011:10:22


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
            "parent_id" : "1" or null,
            "title" : "개발 부서",
            "path" : [1, 4],
            "updated_at" : "2026-03-19 12:29:24.745634+00"
        },
        {
            "type" : "WORK_ITEM",
            "id" : "WI-1101",
            "parent_id" : "WI-110",
            "owner_node_id" : 10,
            "owner_user_id" : "U-12",
            "title" : "테스트 work_item",
            "description" : "테스트용 work_item",
            "status" : "todo",
            "priority" : 3,
            "hidden" : false,
            "weight" : 1,
            "progress" : 0,
            "start_date" : {시작 날짜},
            "due_date" : {마감 날짜},
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
| data | Array | 성공 | 조회된 모든 데이터를 담은 배열 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 |
| id | String | 필수 | 데이터 식별 id |
| node_type | String | node | 노드의 타입 |
| parent_id | Integer | node or work_item | 상위 노드 id or 상위 work_item id |
| title | String | node or work_item | 노드의 이름 or work_item id |
| path | Array | node | 노드의 트리구조 |
| owner_node_id | Integer | work_item | 소속 노드 id |
| owner_user_id | String | work_item | 소유자 id |
| description | String | work_item | work_item 설명 |
| status | String | work_item | work_item 상태 |
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
| updated_at | String | 필수 | 데이터의 최신 업데이트 시간 |

- 설명<br>
1. context_init api를 통해서 가져온 데이터를 서버 데이터와 동기화하는 api
2. 앱에서 지속적으로 서버로 동기화 요청하여 마지막 동기화 시간 이후에 변경된 데이터를 가져온다.
3. 클라이언트 앱 내부적으로 기존 데이터를 최신 데이터로 변경해야 한다.