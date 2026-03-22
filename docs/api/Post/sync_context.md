# 사용자 데이터 동기화 api (version 1)
- 사용자의 마지막 업데이트 시점 이후의 변경 데이터를 조회하는 api
## Request
- Request syntax
```json
{
    "user_id" : "U-2",
    "last_synced_at" : "2026-01-01 00:00:00"
}
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/api/v1/context/sync |

---
- Request Header

| 파라미터 | 타입 | 필수여부 | 설명 |
| :--- | :--- | :--- | :--- |
| Content_type | String | 필수 | application/json |

---
- Request Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| user_id | String | 필수 | 유저 검색용 user_id |
| last_synced_at | String | 필수 | 마지막 동기화 시점 |

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
| parent_id | String | 선택 | 부모 노드 또는 소속 노드 id |
| title | String | 필수 | 노드 또는 work_item 이름 |
| status | String | 선택 | work_item 상태 |
| priority | Integer | 선택 | work_item 우선순위 |
| extra_info | String | 선택 | 노드의 path 또는 work_item의 부모 id |
| updated_at | String | 필수 | 데이터의 최신 업데이트 시간 |

- 설명<br>
1. context_init api를 통해서 가져온 데이터를 서버 데이터와 동기화하는 api
2. 앱에서 지속적으로 서버로 동기화 요청하여 마지막 동기화 시간 이후에 변경된 데이터를 가져온다.
3. 클라이언트 앱 내부적으로 기존 데이터를 최신 데이터로 변경해야 한다.

---
## 업데이트
### version 1 : 서버와 데이터베이스 연결 여부 확인용
- 개선 사항 : token 기능을 추가하여 매개변수로 user_id을 받지 않게 변경 and last_synced_at 파라미터를 url에 포함하여 get 방식으로 변경, 아직 삭제된 데이터에 대해서는 추적 불가능
