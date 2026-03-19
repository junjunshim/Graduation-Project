# work_item api (version 1)
- 최소 단위인 work_item 생성 api
## Request
- Request syntax
```json
{
    "work_item_id" : "WI-1101",
    "owner_node_id" : 10,
    "owner_user_id" : "U-12",
    "title" : "테스트 work_item",
    "parent_work_item_id" : "WI-110",
    "description" : "테스트용 work_item",
    "status" : "todo",
    "priority" : 3,
    "weight" : 1,
    "progress" : 0,
    "start_date" : {시작 날짜},
    "due_date" : {마감 날짜}
}
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/api/v1/workItems |

---
- Request Header

| 파라미터 | 타입 | 필수여부 | 설명 |
| :--- | :--- | :--- | :--- |
| Content_type | String | 필수 | application/json |

---
- Request Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| work_item_id | String | 필수 | 식별용 id |
| owner_node_id | Integer | 필수 | work_item이 생성될 노드 id |
| owner_user_id | String | 필수 | 소유자 유저 id |
| title | String | 필수 | work_item 이름 |
| parent_work_item_id | String | 선택 | 부모 work_item_id |
| description | String | 선택 | work_item 설명 |
| status | String | 선택 | 현재 상태(todo, end 등등) |
| priority | Integer | 선택 | 우선순위 |
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
    "work_item_id" : "WI-101"
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
| work_item_id | Integer | 성공 | 생성한 work_item_id |
| message | String | 에러 | 요청 관련 메세지 |

---
## 업데이트
### version 1 : 서버와 데이터베이스 연결 여부 확인용
- 개선 사항 : token 기능, 해당 노드에 work_item_id 중복 문제 해결 필요

