# 회원가입 api (version 1)
- 회원생성 api
## Request
- Request syntax
```json
{
    "user_id" : "U-100",
    "email" : "test123@gmail.com",
    "name" : "테스터",
    "password" : "test!@2211"
}
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/api/v1/users |

---
- Request Header

| 파라미터 | 타입 | 필수여부 | 설명 |
| :--- | :--- | :--- | :--- |
| Content_type | String | 필수 | application/json |

---
- Request Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| user_id | String | 필수 | 유저 식별 id |
| email | String | 필수 | 유저 이메일 |
| name | String | 필수 | 유저 이름 |
| password | String | 필수 | 비밀번호 |

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
| message | String | 필수 | 요청 관련 메세지 |

---
## 업데이트
### version 1 : 서버와 데이터베이스 연결 여부 확인용
- 개선 사항 : 유저 식별용 user_id에서 시리얼 번호로 변경 필요


