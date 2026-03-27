# work_item api (version 1.1)
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
| Authorization | String | 필수 | Bearer 사용자 토큰 | 

---
- Request Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| work_item_id | String | 필수 | 식별용 id |
| owner_node_id | Integer | 필수 | work_item이 생성될 노드 id |
| owner_user_email | String | 필수 | 담당자 유저 email |
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
    "data" : {
        "type" : "WORK_ITEM",
        "id" : "WI-3",
        "parent_id" : "1",
        "title" : "길찾기 기능 개발",
        "status" : "todo",
        "priority" : 1,
        "extra_info" : "WI-2" 또는 없음,
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
### version 1.0 : 서버와 데이터베이스 연결 여부 확인용
- 개선 사항 : token 기능, 해당 노드에 work_item_id 중복 문제 해결 필요

### version 1.1 : token 기능 추가, 요청자와 대상자의 권한 검증 추가 버전
- 변경 사항 : token 기능 추가, 요청자와 대상자의 email를 통해서 권한 검증 로직 추가
- 개선 사항 : 

