# work_item 삭제 api
- 사용자의 work_item을 삭제하는 api
## Request
- Request syntax
```json
{
    "work_item_id" : "WI-1101"
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
            "status" : "deleted",
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
| data | json | 성공 | 생성된 work__item의 데이터 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 |
| id | String | 필수 | work_item 식별 id|
| status | String | 필수 | 삭제 성공 메세지 |
| updated_at | String | 필수 | 데이터의 최신 업데이트 시간 |