# 정기 일정 파일 다운로드 api
- file_id를 기반으로 정기 일정 전용 첨부파일을 바이너리 스트림으로 다운로드하는 api
## Request
- Request syntax
```json
{
}
```

| Method | URL |
| :--- | :--- |
| Get | http://{서버 url}/api/recurringRules/files/7/download |

---
- Request Header

| 파라미터 | 타입 | 필수여부 | 설명 |
| :--- | :--- | :--- | :--- |
| Authorization | String | 필수 | Bearer 사용자 토큰 |
| If-Modified-Since | String | 선택 | 클라이언트가 캐시한 마지막 수정 시각. 일치 시 304 반환 |

---
- Request Parameters

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| fileId | Integer | 필수 | 다운로드할 파일의 식별 id (URL 경로) |

---

## Response
- Response (파일 변경 시 / 최초 다운로드)
  - **HTTP Status**: 200 OK
  - **Content-Type**: 파일 MIME 타입
  - **Content-Disposition**: attachment; filename=원본파일이름.docx
  - **Last-Modified**: 2026-09-03T18:00:00Z
  - **Cache-Control**: public, max-age=3600
  - **Body**: 실제 파일의 바이너리 데이터 스트림

- Response (파일 미변경 시 / 304 조건부 캐시 히트)
  - **HTTP Status**: 304 Not Modified
  - **Body**: 빈 본문 (0 바이트 전송으로 대역폭 절약)

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

## 정책
- 조회자는 일정 작성자이거나 해당 노드에 `FILE_VIEW` 권한이 있어야 한다.
- 삭제된 파일은 다운로드할 수 없다.