# 역할 부여 api (version 1)
- 유저에게 노드에 대한 권한 부여 api
## Request
- Request syntax
```json
{
    "email" : "test123@gmail.com",
    "node_id" : 12,
    "role_name" : "MANAGER"
}
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/api/v1/roles |

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
| email | String | 필수 | 유저 검색용 email |
| node_id | Integer | 필수 | 권한을 생성할 노드 |
| role_name | String | 필수 | 역할 이름 |

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "data" : {
        "node_id" : 10,
        "user_email" : "admin123@naver.com",
        "role_name" : "ADMIN"
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
| :--- | :--- | :--- | :--- |
| status | String | 필수 | 요청 성공/실패 |
| data | json | 성공 | 생성한 권한 데이터 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| node_id | String | 필수 | 권한이 생성된 노드 id |
| user_email | Integer | 필수 | 해당 권한을 가지고 있는 유저 이메일 |
| role_name | String | 필수 | 권한의 이름 |

---
## 업데이트
### version 1.0 : 서버와 데이터베이스 연결 여부 확인용
- 개선 사항 : token 기능, 역할에 대한 권한 테이블 추가, 이메일을 통한 유저 검색을 할때 예외 처리 필요

### version 1.1 : token 기능 추가한 버전
- 변경 사항 : 기존 user_id를 넘기는 방식에서 token을 사용한 사용자 인증으로 변경, 생성한 권한의 데이터를 반환
- 개선 사항 : 반환 데이터 형식에 더 자세할 필요가 있어보인다.

