# 정기 일정 파일 삭제 api
- 정기 일정 전용 첨부파일을 삭제(소프트 딜리트)하는 api
- 업로더 본인이거나 노드에 `FILE_CHANGE` 권한이 있어야 합니다.
## Request
- Request syntax
```json
{
}
```

| Method | URL |
| :--- | :--- |
| Delete | http://{서버 url}/api/recurringRules/files/7 |

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
| fileId | Integer | 필수 | 삭제할 첨부 파일 식별 id (URL 경로) |

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "data" : [
        {
            "type" : "RECURRING_RULE_FILE",
            "file_id" : 7,
            "rule_id" : 3,
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
| data | Array | 성공 | 삭제 처리된 파일 데이터 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 (RECURRING_RULE_FILE) |
| file_id | Integer | 필수 | 삭제된 첨부 파일 식별 id |
| rule_id | Integer | 필수 | 소속 정기 일정 id |
| is_deleted | Boolean | 필수 | 삭제 여부 (true) |

## 정책
- 이미 삭제된 파일은 다시 삭제할 수 없다.
- 삭제된 파일은 15일 후 백그라운드 정리 작업으로 영구 삭제된다.