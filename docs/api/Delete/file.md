# work_item 첨부 파일 삭제 api
- 특정 첨부 파일을 삭제(소프트 딜리트)하는 api
## Request
- Request syntax
```json
{
    "file_id" : 1
}
```

| Method | URL |
| :--- | :--- |
| Delete | http://{서버 url}/api/workItems/files |

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
| file_id | Integer | 필수 | 삭제할 첨부 파일 식별 id |

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "data" : [
        {
            "file_id" : 1,
            "work_item_id" : "WI-104",
            "is_deleted" : true
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
| data | Array | 성공 | 삭제 처리된 파일 데이터 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| file_id | Integer | 필수 | 삭제된 첨부 파일 식별 id |
| work_item_id | String | 필수 | 소속 work_item id |
| is_deleted | Boolean | 필수 | 삭제 여부 (true) |
