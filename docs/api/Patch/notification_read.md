# 알림 읽음 처리 api
- 사용자의 멘션 알림을 읽음 상태로 갱신하는 api
## Request
- Request syntax
```json
{
    "mention_id" : 12
}
```

| Method | URL |
| :--- | :--- |
| Patch | http://{서버 url}/api/users/notifications/read |

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
| mention_id | Integer | 필수 | 읽음 처리할 알림 식별 id |

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "data" : [
        {
            "type" : "MENTION",
            "id" : 12,
            "comment_id" : 101,
            "work_item_id" : "WI-100",
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
| data | Array | 성공 | 갱신된 멘션 알림 데이터 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 (MENTION) |
| id | Integer | 필수 | 알림 식별 id |
| comment_id | Integer | 필수 | 멘션이 발생한 댓글 id |
| work_item_id | String | 필수 | 멘션이 발생한 work_item id |
| message | String | 필수 | 알림 본문 문구 |
| is_read | Boolean | 필수 | 읽음 상태 여부 (true) |
| created_at | String | 필수 | 알림 발생 일시 |
| updated_at | String | 필수 | 알림 상태 갱신 일시 |
