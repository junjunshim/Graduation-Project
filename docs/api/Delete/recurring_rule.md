# 정기 일정 삭제 api
- 정기 일정(반복 규칙)을 삭제(소프트 딜리트)하는 api
- 일정 전용 첨부파일도 함께 소프트 딜리트됩니다.
- 작성자/담당자이거나 노드에 `WI_PERSONAL_CHANGE`(본인 일정) 또는 `WI_OTHERS_CHANGE`(타인 일정) 권한이 있어야 합니다.
## Request
- Request syntax
```json
{
}
```

| Method | URL |
| :--- | :--- |
| Delete | http://{서버 url}/api/recurringRules/3 |

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
| ruleId | Integer | 필수 | 삭제할 정기 일정 식별 id (URL 경로) |

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "data" : [
        {
            "type" : "RECURRING_RULE",
            "rule_id" : 3,
            "owner_node_id" : 98,
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
| data | Array | 성공 | 삭제 처리된 정기 일정 데이터 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 (RECURRING_RULE) |
| rule_id | Integer | 필수 | 정기 일정 식별 id |
| owner_node_id | Integer | 필수 | 일정 소속 노드 id |
| is_deleted | Boolean | 필수 | 삭제 여부 (true) |

## 정책
- 이미 삭제된 일정은 다시 삭제할 수 없다.
- 삭제된 일정은 15일 후 백그라운드 정리 작업으로 영구 삭제된다.