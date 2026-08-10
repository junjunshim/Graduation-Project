# user 삭제 api
- 사용자 삭제 api
## Request
- Request Syntax
```json
{
    "target_email" : "target@gmail.com"
}
```

| Method | URL |
| :--- | :--- |
| Delete | http://{서버 url}/api/users |

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
| target_email | String | 필수 | 조회할 사용자 이메일 |

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "message" : {성공 메세지}
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
| message | String | 에러 | 요청 관련 메세지 |