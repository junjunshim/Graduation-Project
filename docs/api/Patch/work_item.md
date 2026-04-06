# work_item 업데이트 api (version 1.0.0)
- 사용자의 work_item을 변경하는 api
## Request
- Request syntax
```json
{
    "work_item_id" : "WI-1101",
    "title" : "테스트 work_item",
    "description" : "테스트용 work_item",
    "status" : "todo",
    "priority" : 4,
    "weight" : 12,
    "progress" : 32,
    "start_date" : "2026-03-03",
    "due_date" : "2023-04-25"
}
```

| Method | URL |
| :--- | :--- |
| Patch | http://{서버 url}/api/v1/workItems |

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
| title | String | 선택 | 변경할 work_item 이름 |
| description | String | 선택 | 변경할 work_item 설명 |
| status | String | 선택 | 변경할 현재 상태(todo, end 등등) |
| priority | Integer | 선택 | 변경할 우선순위 |
| weight | Integer | 선택 | 변경할 가중치 |
| progress | Integer | 선택 | 변경할 진행도 |
| start_date | DATE | 선택 | 변경할 시작 날짜 |
| due_date | DATE | 선택 | 변경할 마감 날짜 |

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "data" : {
        "type" : "WORK_ITEM",
        "id" : "WI-1101",
        "parent_id" : "10",
        "title" : "테스트용 work_item",
        "status" : "todo",
        "priority" : 4,
        "extra_info" : "WI-110" 또는 없음,
        "updated_at" : "2026-03-19 12:29:24.745634+00"
    }
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
| data | json | 성공 | 생성된 work__item의 데이터 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 |
| id | String | 필수 | work_item 식별 id|
| parent_id | String | 선택 | 소속 노드 id |
| title | String | 필수 | work_item 이름 |
| status | String | 선택 | work_item 상태 |
| priority | Integer | 선택 | work_item 우선순위 |
| extra_info | String | 선택 | work_item의 부모 id |
| updated_at | String | 필수 | 데이터의 최신 업데이트 시간 |

---
## 업데이트
### version 1.0.0 : 업데이트 초기 버전
- 개선 사항 : 반환 데이터에 work_item의 상세 정보도 추가해야함