# work_item 파일 업로드 api
- 특정 work_item에 첨부 파일을 업로드하는 api (Multipart Form-Data)
## Request
- Request Syntax
```
Content-Type: multipart/form-data
- Form Data:
  work_item_id: "WI-104"
  file: (바이너리 파일 데이터)
```

| Method | URL |
| :--- | :--- |
| Post | http://{서버 url}/api/workItems/files/upload |

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
| work_item_id | String | 필수 | 파일을 첨부할 대상 work_item id |
| file | File | 필수 | 업로드할 실제 파일 (바이너리) |

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "data" : [
        {
            "file_id" : 1,
            "work_item_id" : "WI-104",
            "uploader_user_id" : "U-12",
            "uploader_name" : "홍길동",
            "uploader_email" : "hong@example.com",
            "original_file_name" : "설계문서.pdf",
            "file_size" : 1048576,
            "mime_type" : "application/pdf",
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
| data | Array | 성공 | 등록된 첨부 파일 메타데이터 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| file_id | Integer | 필수 | 생성된 첨부 파일 식별 id |
| work_item_id | String | 필수 | 소속 work_item id |
| uploader_user_id | String | 필수 | 업로더 유저 id |
| uploader_name | String | 필수 | 업로더 이름 |
| uploader_email | String | 필수 | 업로더 이메일 |
| original_file_name | String | 필수 | 사용자가 올린 원본 파일명 |
| file_size | Integer | 필수 | 파일 크기 (Byte 단위) |
| mime_type | String | 선택 | 파일의 MIME 타입 |
| created_at | String | 필수 | 파일 업로드 일시 |
