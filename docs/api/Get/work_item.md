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
            "work_item_id" : "WI-1",
            "parent_work_item_id" : null,
            "owner_node_id" : 100,
            "owner_user_id" : "U-1",
            "owner_user_email" : "kim@test.com",
            "owner_user_name" : "김철수",
            "title" : "2024 신규 서비스 런칭",
            "description" : "신규 서비스 런칭 프로젝트입니다.",
            "category" : "PROJECT",
            "status" : "in_progress",
            "priority" : 3,
            "weight" : 1,
            "progress" : 30,
            "hidden" : false,
            "start_date" : "2026-03-01",
            "due_date" : "2026-06-30",
            "created_at" : "2026-03-19 12:29:24.745634+00",
            "updated_at" : "2026-03-19 12:29:24.745634+00",
            "comments" : [
                {
                    "comment_id" : 1,
                    "author_user_id" : "U-1",
                    "author_name" : "김철수",
                    "author_email" : "kim@test.com",
                    "content" : "1차 스프린트 완료되었습니다.",
                    "created_at" : "2026-03-19 13:00:00+00"
                }
            ],
            "files" : [
                {
                    "file_id" : 1,
                    "uploader_user_id" : "U-1",
                    "uploader_name" : "김철수",
                    "uploader_email" : "kim@test.com",
                    "original_file_name" : "기획서_v1.0.pdf",
                    "file_size" : 1048576,
                    "mime_type" : "application/pdf",
                    "created_at" : "2026-03-19 13:10:00+00"
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
| data | Array | 성공 | 업무 상세 정보, 댓글 목록, 파일 목록이 포함된 데이터 배열 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 (WORK_ITEM_DETAIL) |
| work_item_id | String | 필수 | 업무 식별 ID |
| parent_work_item_id | String or Null | 선택 | 부모 업무 ID |
| owner_node_id | Integer | 필수 | 업무 소속 조직 노드 ID |
| owner_user_id | String | 필수 | 담당자 사용자 ID |
| owner_user_email | String | 필수 | 담당자 이메일 |
| owner_user_name | String | 필수 | 담당자 이름 |
| title | String | 필수 | 업무 제목 |
| description | String or Null | 선택 | 업무 설명 |
| category | String or Null | 선택 | 업무 카테고리 |
| status | String | 필수 | 업무 상태 (todo, in_progress, done 등) |
| priority | Integer | 필수 | 우선순위 (1~5) |
| weight | Integer | 필수 | 가중치 |
| progress | Integer | 필수 | 진행률 (0~100) |
| hidden | Boolean | 필수 | 숨김 여부 |
| start_date | String or Null | 선택 | 시작 일자 |
| due_date | String or Null | 선택 | 마감 일자 |
| created_at | String | 필수 | 생성 일시 |
| updated_at | String | 필수 | 최신 수정 일시 |
| comments | Array | 필수 | 업무에 작성된 댓글 목록 |
| files | Array | 필수 | 첨부된 파일 목록 (조회 권한 없을 시 빈 배열) |
