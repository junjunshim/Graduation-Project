# work_item 상세 정보 조회 api
- 특정 work_item의 전체 필드 정보와 작성된 댓글, 첨부 파일 목록을 함께 조회하는 api
## Request
- Request syntax
```json
{
}
```

| Method | URL |
| :--- | :--- |
| Get | http://{서버 url}/api/workItems?work_item_id=WI-104 |

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
| work_item_id | String | 필수 | 조회할 work_item 식별 id |

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "data" : [
        {
            "type" : "WORK_ITEM_DETAIL",
            "work_item_id" : "WI-104",
            "parent_work_item_id" : "WI-100",
            "owner_node_id" : 10,
            "owner_user_id" : "U-12",
            "owner_user_email" : "owner@example.com",
            "owner_user_name" : "홍길동",
            "title" : "서버 API 개발",
            "description" : "WorkItem 상세 API 개발 태스크",
            "status" : "in_progress",
            "priority" : 3,
            "weight" : 1,
            "progress" : 50,
            "hidden" : false,
            "start_date" : "2026-03-01",
            "due_date" : "2026-03-31",
            "created_at" : "2026-03-01 09:00:00.000000+00",
            "updated_at" : "2026-03-19 12:29:24.745634+00",
            "comments" : [
                {
                    "comment_id" : 1,
                    "author_user_id" : "U-15",
                    "author_name" : "이순신",
                    "author_email" : "lee@example.com",
                    "content" : "@홍길동 개발 진행상황 확인 부탁드립니다.",
                    "created_at" : "2026-03-19 10:00:00.000000+00"
                }
            ],
            "files" : [
                {
                    "file_id" : 1,
                    "uploader_user_id" : "U-15",
                    "uploader_name" : "이순신",
                    "uploader_email" : "lee@example.com",
                    "original_file_name" : "설계문서.pdf",
                    "file_size" : 1048576,
                    "mime_type" : "application/pdf",
                    "created_at" : "2026-03-19 10:05:00.000000+00"
                }
            ]
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
| data | Array | 성공 | 조회된 work_item 상세 데이터 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 (WORK_ITEM_DETAIL) |
| work_item_id | String | 필수 | work_item 식별 id |
| parent_work_item_id | String or Null | 선택 | 상위 work_item 식별 id |
| owner_node_id | Integer | 필수 | 소속 조직 노드 id |
| owner_user_id | String | 필수 | 담당자 유저 id |
| owner_user_email | String | 필수 | 담당자 이메일 |
| owner_user_name | String | 필수 | 담당자 이름 |
| title | String | 필수 | 업무 제목 |
| description | String | 선택 | 업무 상세 설명 |
| status | String | 필수 | 진행 상태 |
| priority | Integer | 필수 | 우선순위 |
| weight | Integer | 필수 | 가중치 |
| progress | Integer | 필수 | 진행도 (0~100) |
| hidden | Boolean | 필수 | 숨김 여부 |
| start_date | String | 선택 | 시작 일자 |
| due_date | String | 선택 | 마감 일자 |
| created_at | String | 필수 | 업무 생성 일시 |
| updated_at | String | 필수 | 업무 최근 수정 일시 |
| comments | Array | 필수 | 등록된 댓글 목록 배열 |
| files | Array | 필수 | 첨부된 파일 목록 배열 (FILE_VIEW 권한 없을 시 빈 배열) |
