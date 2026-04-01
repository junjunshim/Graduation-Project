# 사용자 전체 정보 조회 api (version 1.1.1)
- 사용자가 속한 노드와 해당 노드의 모든 work_item를 조회하는 api
## Request
- Request syntax
```json
{
}
```

| Method | URL |
| :--- | :--- |
| Get | http://{서버 url}/api/v1/context/init |

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
            "node_type" : "DEPARTMENT",
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
| id | String | 필수 | 노드 또는 work_item 식별 id|
| node_type | String | 선택 | node의 type | 
| parent_id | String | 선택 | 부모 노드 또는 소속 노드 id |
| title | String | 필수 | 노드 또는 work_item 이름 |
| status | String | 선택 | work_item 상태 |
| priority | Integer | 선택 | work_item 우선순위 |
| extra_info | String | 선택 | 노드의 path 또는 work_item의 부모 id |
| updated_at | String | 필수 | 데이터의 최신 업데이트 시간 |

- 설명<br>
1. 기본적으로 데이터는 평면 리스트 형태로 제공, 프론트에서 트리형태로 변환하는 로직이 필요<br>
2. 각 데이터 타입은 반환을 위해서 문자열로 통일, 프론트에서 배열 또는 정수형 데이터 변환하는 로직이 필요

---
## 업데이트
### version 1.0 : 서버와 데이터베이스 연결 여부 확인용
- 개선 사항 : token 기능을 추가하여 매개변수로 user_id을 받지 않게 변경 and get 방식으로 변경

### version 1.1.0 : token 기능 추가한 버전
- 변경 사항 : 기존 user_id를 넘기는 방식에서 token을 사용한 사용자 인증으로 변경, HttpMethod를 Get 방식으로 변경
- 개선 사항 : 화면 구성에 role 데이터도 필요

### version 1.1.1 : NODE 타입 데이터의 node_type 값 반환
- 변경 사항 : NODE 타입 데이터의 node_type데이터도 반환하도록 변경
- 개선 사항 : 화면 구성에 role 데이터도 필요
