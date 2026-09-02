# work_item 첨부 파일 다운로드 api
- file_id를 기반으로 서버에 저장된 실제 물리 파일을 바이너리 스트림으로 다운로드하는 api
## Request
- Request syntax
```json
{
}
```

| Method | URL |
| :--- | :--- |
| Get | http://{서버 url}/api/workItems/files/download?file_id=1 |

---
- Request Header

| 파라미터 | 타입 | 필수여부 | 설명 |
| :--- | :--- | :--- | :--- |
| Authorization | String | 필수 | Bearer 사용자 토큰 |

---
- Request Parameters

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| file_id | Integer | 필수 | 다운로드할 파일의 식별 id |

---

## Response
- Response (성공 시)
  - **HTTP Status**: 200 OK
  - **Content-Type**: application/octet-stream
  - **Content-Disposition**: attachment; filename=원본파일이름.pdf
  - **Body**: 실제 파일의 바이너리 데이터 스트림

- Response Syntax (실패 시)
```json
{
    "status" : "error",
    "message" : {에러 메세지}
}
```

- Response Elements (실패 시)

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| status | String | 필수 | error |
| message | String | 에러 | 실패 원인 메세지 |
