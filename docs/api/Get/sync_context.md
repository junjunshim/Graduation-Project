# 사용자 데이터 동기화 api (version 1.1.1)
- 사용자의 마지막 업데이트 시점 이후의 변경 데이터를 조회하는 api
## Request
- Request syntax
```json
{
}
```

| Method | URL |
| :--- | :--- |
| Get | http://{서버 url}/api/v1/context/sync |

---
- Request Header

| 파라미터 | 타입 | 필수여부 | 설명 |
| :--- | :--- | :--- | :--- |
| Content_type | String | 필수 | application/json |
| Authorization | String | 필수 | Bearer 사용자 토큰 | 

---
- Query Parameters

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| last_synced_at | String | 필수 | 마지막 동기화 시점 (YYYY-MM-DD HH:MM:SS), 미입력 시 전체 데이터를 반환|

- Example : /api/v1/context/sync?last_synced_at=2026-03-24%2011:10:22


---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "data" : [
        # 데이터가 node일때
        {
            "type" : "NODE",
            "id" : "3",
            "parent_id" : "1" 또는 없음,
            "title" : "영업 부서",
            "extra_info" : "{1, 3}",
            "updated_at" : "2026-03-19 12:29:24.745634+00"
        }
        ,
        # 데이터가 work_item일때
        {
            "type" : "WORK_ITEM",
            "id" : "WI-3",
            "parent_id" : "1",
            "title" : "길찾기 기능 개발",
            "status" : "todo",
            "priority" : 1,
            "extra_info" : "WI-2" 또는 없음,
            "updated_at" : "2026-03-19 12:29:24.745634+00"
        },
        # 데이터가 role일때
        {
            "type" : "ROLE",
            "id" : "11",
            "parent_id" : "1",
            "title" : "test123@gmail.com",
            "status" : "ADMIN",
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
| data | Array | 성공 | 조회된 모든 데이터를 담은 배열 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 |
| id | String | 필수 | 노드 or work_item or role 식별 id|
| node_type | String | 선택 | node의 type | 
| parent_id | String | 선택 | 부모 노드 or 소속 노드 id |
| title | String | 필수 | 노드 or work_item 이름 or 권한의 사용자 이메일|
| status | String | 선택 | work_item 상태 or 권한 이름 |
| priority | Integer | 선택 | work_item 우선순위 |
| extra_info | String | 선택 | 노드의 path or work_item의 부모 id |
| updated_at | String | 필수 | 데이터의 최신 업데이트 시간 |

- 설명<br>
1. context_init api를 통해서 가져온 데이터를 서버 데이터와 동기화하는 api
2. 앱에서 지속적으로 서버로 동기화 요청하여 마지막 동기화 시간 이후에 변경된 데이터를 가져온다.
3. 클라이언트 앱 내부적으로 기존 데이터를 최신 데이터로 변경해야 한다.

---
## 업데이트
### version 1.0 : 서버와 데이터베이스 연결 여부 확인용
- 개선 사항 : token 기능을 추가하여 매개변수로 user_id을 받지 않게 변경 and last_synced_at 파라미터를 url에 포함하여 get 방식으로 변경, 아직 삭제된 데이터에 대해서는 추적 불가능

### version 1.1.0 : token 기능 추가한 버전
- 변경 사항 : 기존 user_id를 넘기는 방식에서 token을 사용한 사용자 인증으로 변경, HttpMethod를 Get 방식으로 변경
- 개선 사항 : 삭제된 데이터에 대한 동기화 필요, role 데이터 추가

### version 1.1.1 : 반환 데이터에 ROLE 추가, NODE 타입 데이터의 node_type 값 반환
- 변경 사항 : ROLE 데이터도 반환하도록 변경, NODE 타입 데이터의 node_type데이터도 반환하도록 변경
- 개선 사항 : 삭제된 데이터에 대한 동기화 필요