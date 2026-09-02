# work_item 댓글 작성 api
- 특정 work_item에 댓글을 등록하고 멘션(@사용자이름) 시 실시간 알림을 발송하는 api
## Request
- Request syntax
```json
{
    "work_item_id" : "WI-104",
    "content" : "@홍길동 이번 주 금요일까지 완료 부탁드립니다."
}
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/api/workItems/comments |

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
| work_item_id | String | 필수 | 댓글을 작성할 대상 work_item id |
| content | String | 필수 | 댓글 본문 내용 (멘션 포함 가능) |

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "data" : [
        {
            "comment_id" : 1,
            "work_item_id" : "WI-104",
            "author_user_id" : "U-12",
            "author_name" : "이순신",
            "author_email" : "lee@example.com",
            "content" : "@홍길동 이번 주 금요일까지 완료 부탁드립니다.",
            "created_at" : "2026-03-19 12:29:24.745634+00"
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
| data | Array | 성공 | 생성된 댓글 데이터 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| comment_id | Integer | 필수 | 생성된 댓글 식별 id |
| work_item_id | String | 필수 | 댓글이 등록된 work_item id |
| author_user_id | String | 필수 | 작성자 유저 id |
| author_name | String | 필수 | 작성자 이름 |
| author_email | String | 필수 | 작성자 이메일 |
| content | String | 필수 | 댓글 내용 |
| created_at | String | 필수 | 댓글 작성 일시 |
