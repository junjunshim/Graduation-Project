# work_item 파일 복구 api
- 휴지통(삭제 상태)에 있는 특정 첨부 파일을 복구하는 api
## Request
- Request Syntax
```json
{
    "file_id" : 85
}
```

| Method | URL |
| :--- | :--- |
| Patch | http://{서버 url}/api/workItems/files/restore |

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
| file_id | Integer | 필수 | 복구할 대상 파일 식별 id |

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "data" : [
        {
            "type" : "FILE",
            "id" : 85,
            "work_item_id" : "WI-104",
            "uploader_user_id" : "U-163",
            "uploader_name" : "애플 기획부 팀장",
            "uploader_email" : "apple_1dept_leader@apple.com",
            "original_file_name" : "requirements_v1.pdf",
            "file_size" : 1048576,
            "mime_type" : "application/pdf",
            "is_deleted" : false,
            "created_at" : "2026-09-02T08:00:00+00:00",
            "updated_at" : "2026-09-02T11:43:00+00:00"
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
| data | Array | 성공 | 복구된 파일 데이터 리스트 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 (FILE) |
| id | Integer | 필수 | 파일 식별 id |
| work_item_id | String | file | 소속된 업무 식별 id |
| uploader_user_id | String | file | 업로더 사용자 id |
| uploader_name | String | file | 업로더 이름 |
| uploader_email | String | file | 업로더 이메일 |
| original_file_name | String | file | 원본 파일명 |
| file_size | Integer | file | 파일 크기 (Bytes) |
| mime_type | String | file | 파일 MIME 타입 |
| is_deleted | Boolean | file | 삭제 여부 (false) |
| created_at | String | file | 업로드 일시 |
| updated_at | String | file | 복구 일시 |
