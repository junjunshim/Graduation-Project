# 정기 일정 파일 업로드 api
- 정기 일정 전용 첨부파일(양식, 매뉴얼 등)을 업로드하는 api (Multipart Form-Data)
- 작성자/담당자이거나 노드에 `FILE_CHANGE` 권한이 있어야 합니다.
## Request
- Request Syntax
```
Content-Type: multipart/form-data
- Form Data:
  file: (바이너리 파일 데이터)
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/api/recurringRules/3/files |

---
- Request Header

| 파라미터 | 타입 | 필수여부 | 설명 |
| :--- | :--- | :--- | :--- |
| Content_type | String | 필수 | multipart/form-data |
| Authorization | String | 필수 | Bearer 사용자 토큰 |

---
- Request Form Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| ruleId | Integer | 필수 | 파일을 첨부할 정기 일정 식별 id (URL 경로) |
| file | File | 필수 | 업로드할 실제 파일 (바이너리) |

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "data" : {
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
        "created_at" : "2026-09-01T00:00:00.000000Z"
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
| status | String | 필수 | 요청 성공/실패 |
| data | Object | 성공 | 등록된 일정 전용 첨부파일 메타데이터 (RECURRING_RULE_FILE) |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 (RECURRING_RULE_FILE) |
| file_id | Integer | 필수 | 생성된 첨부 파일 식별 id |
| rule_id | Integer | 필수 | 소속 정기 일정 id |
| uploader_user_id | String | 필수 | 업로더 사용자 id |
| uploader_name | String | 필수 | 업로더 이름 |
| uploader_email | String | 필수 | 업로더 이메일 |
| original_file_name | String | 필수 | 사용자가 올린 원본 파일명 |
| file_size | Integer | 필수 | 파일 크기 (Bytes) |
| mime_type | String or Null | 선택 | 파일의 MIME 타입 |
| is_deleted | Boolean | 필수 | 삭제 여부 |
| created_at | String | 필수 | 업로드 일시 |

## 정책
- 파일은 서버의 `./uploads/recurring_rules/{ruleId}` 경로에 UUID 파일명으로 저장된다.
- 작성자/담당자가 아니면 노드의 `FILE_CHANGE` 권한이 필요하다.