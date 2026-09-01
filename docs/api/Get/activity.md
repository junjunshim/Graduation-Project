# 활동 기록 조회 api
- 특정 노드 및 사용자의 활동 기록 조회 api
## Request
- Request Syntax
```json
{
}
```

| Method | URL |
| :--- | :--- |
| Get | http://{서버 url}/org/activities?target_email=target@gmail.com&node_id=13 |

---
- Request Header

| 파라미터 | 타입 | 필수여부 | 설명 |
| :--- | :--- | :--- | :--- |
| Content_type | String | 필수 | application/json |
| Authorization | String | 필수 | Bearer 사용자 토큰 | 

---
- Request Parameters

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| target_email | String | 선택 | 조회할 사용자 이메일 |
| node_id | Integer | 선택 | 조회할 노드의 id |

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "data" : [
        {
            "type" : "ACTIVITY",
            "id" : 12,
            "node_id" : 123,
            "actor_user_id" : "U-12",
            "actor_name" : "홍길동",
            "entity_type" : "NODE",
            "entity_id" : 12,
            "target_name" : "영업부서",
            "action_type" : "updated",
            "field_name" : "hidden",
            "old_value" : false,
            "new_value" : true,
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
| data | Array | 성공 | 조회된 모든 데이터를 담은 배열 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 |
| id | Integer | 필수 | 데이터 식별 id |
| node_id | Integer | 필수 | 기록이 생성된 node id |
| actor_user_id | String | 필수 | 활동한 사용자 id |
| actor_name | String | 필수 | 활동한 사용자 이름 |
| entity_type | String | 필수 | 객체 타입  |
| entity_id | String or Interger | 필수 | 객체 식별 id |
| target_name | String | 필수 | 객체 이름 |
| action_type | String | 필수 | 어떤 활동인지 구별 |
| field_name | String | 선택 | 변경 또는 생성된 필드명 |
| old_value | String | 선택 | 변경 이전 값 |
| new_value | String | 선택 | 변경 또는 생성시 생성된 값 |
| created_at | String | 필수 | 기록 생성 날짜 |
