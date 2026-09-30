# 정기 일정 파일 복구 api
- 휴지통(삭제 상태)에 있는 정기 일정 전용 첨부파일을 복구하는 api
- 상위 정기 일정이 아직 삭제 상태이면 복구할 수 없습니다.
- 업로더 본인이거나 노드에 `FILE_CHANGE` 권한이 있어야 합니다.
## Request
- Request syntax
```json
{
}
```

| Method | URL |
| :--- | :--- |
| Patch | http://{서버 url}/api/recurringRules/files/7/restore |

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
| fileId | Integer | 필수 | 복구할 첨부 파일 식별 id (URL 경로) |

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
            "uploader_user_id" : "U-163",
            "uploader_name" : "애플 기획부 팀장",
            "uploader_email" : "apple_1dept_leader@apple.com",
            "original_file_name" : "meeting_template.docx",
            "file_size" : 20480,
            "mime_type" : null,
            "is_deleted" : false,
            "created_at" : "2026-09-01T00:00:00.000000Z",
            "updated_at" : "2026-09-21T00:00:00.000000Z"
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
| data | Array | 성공 | 복구된 파일 데이터 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 (RECURRING_RULE_FILE) |
| file_id | Integer | 필수 | 파일 식별 id |
| rule_id | Integer | 필수 | 소속 정기 일정 id |
| uploader_user_id | String | 필수 | 업로더 사용자 id |
| uploader_name | String | 필수 | 업로더 이름 |
| uploader_email | String | 필수 | 업로더 이메일 |
| original_file_name | String | 필수 | 원본 파일명 |
| file_size | Integer | 필수 | 파일 크기 (Bytes) |
| mime_type | String or Null | 선택 | 파일 MIME 타입 |
| is_deleted | Boolean | 필수 | 삭제 여부 (false) |
| created_at | String | 필수 | 업로드 일시 |
| updated_at | String | 필수 | 복구 일시 |

## 정책
- 상위 정기 일정이 삭제 상태이면 복구할 수 없다. (HTTP 409)