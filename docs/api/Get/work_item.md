# work_item 상세 정보 조회 api
- 특정 work_item의 전체 필드 정보와 작성된 댓글, 첨부 파일 목록, 활동 이력을 함께 조회하는 api
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
            "display_id" : 1,
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
            "computed_progress" : 30,
            "hidden" : false,
            "is_deleted" : false,
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
                    "is_deleted" : false,
                    "created_at" : "2026-03-19 13:10:00+00"
                }
            ],
            "activities" : [
                {
                    "id" : 501,
                    "node_id" : 100,
                    "actor_user_id" : "U-1",
                    "actor_name" : "김철수",
                    "entity_type" : "WORK_ITEM",
                    "entity_id" : "WI-1",
                    "target_name" : "2024 신규 서비스 런칭",
                    "action_type" : "updated",
                    "field_name" : "status",
                    "old_value" : "todo",
                    "new_value" : "in_progress",
                    "created_at" : "2026-03-19 12:29:24.745634+00"
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
| data | Array | 성공 | 업무 상세 정보, 댓글 목록, 파일 목록, 활동 이력이 포함된 데이터 배열 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 (WORK_ITEM_DETAIL) |
| work_item_id | String | 필수 | 업무 식별 ID |
| display_id | Integer | 필수 | 노드 내 업무 표시 번호 |
| parent_work_item_id | String or Null | 선택 | 부모 업무 ID |
| owner_node_id | Integer | 필수 | 업무 소속 조직 노드 ID |
| owner_user_id | String | 필수 | 담당자 사용자 ID |
| owner_user_email | String | 필수 | 담당자 이메일 |
| owner_user_name | String | 필수 | 담당자 이름 |
| title | String | 필수 | 업무 제목 |
| description | String or Null | 선택 | 업무 설명 |
| category | String or Null | 선택 | 업무 카테고리 |
| status | String | 필수 | 업무 상태 (todo, in_progress, done 등) |
| priority | Integer | 필수 | 우선순위 |
| weight | Integer | 필수 | 가중치 |
| progress | Integer | 필수 | 진행률 |
| computed_progress | Integer | 필수 | 하위 업무를 반영한 계산 진행률 |
| hidden | Boolean | 필수 | 숨김 여부 |
| is_deleted | Boolean | 필수 | 삭제 여부 |
| start_date | String or Null | 선택 | 시작 일자 |
| due_date | String or Null | 선택 | 마감 일자 |
| created_at | String | 필수 | 생성 일시 |
| updated_at | String | 필수 | 최신 수정 일시 |
| comments | Array | 필수 | 업무에 작성된 댓글 목록 |
| files | Array | 필수 | 첨부된 파일 목록 (조회 권한 없을 시 빈 배열) |
| activities | Array | 필수 | 해당 업무의 활동 이력 목록 |

- comments Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| comment_id | Integer | 필수 | 댓글 식별 id |
| author_user_id | String | 필수 | 작성자 사용자 id |
| author_name | String | 필수 | 작성자 이름 |
| author_email | String | 필수 | 작성자 이메일 |
| content | String | 필수 | 댓글 내용 |
| created_at | String | 필수 | 댓글 작성 일시 |

- files Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| file_id | Integer | 필수 | 파일 식별 id |
| uploader_user_id | String | 필수 | 업로더 사용자 id |
| uploader_name | String | 필수 | 업로더 이름 |
| uploader_email | String | 필수 | 업로더 이메일 |
| original_file_name | String | 필수 | 원본 파일명 |
| file_size | Integer | 필수 | 파일 크기 (Bytes) |
| mime_type | String or Null | 선택 | 파일 MIME 타입 |
| is_deleted | Boolean | 필수 | 삭제 여부 |
| created_at | String | 필수 | 업로드 일시 |

- activities Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| id | Integer | 필수 | 활동 로그 식별 id |
| node_id | Integer | 필수 | 활동이 발생한 노드 id |
| actor_user_id | String | 필수 | 활동 수행자 id |
| actor_name | String | 필수 | 활동 수행자 이름 |
| entity_type | String | 필수 | 활동 대상 객체 종류 |
| entity_id | String | 필수 | 활동 대상 객체 id |
| target_name | String | 필수 | 대상 객체 명칭 |
| action_type | String | 필수 | 활동 종류 (inserted, updated, deleted, restored) |
| field_name | String or Null | 선택 | 변경된 필드명 |
| old_value | String or Null | 선택 | 변경 이전 값 |
| new_value | String or Null | 선택 | 변경 이후 값 |
| created_at | String | 필수 | 활동 일시 |

## 정책
- 요청자는 업무 소속 노드에 `WI_PUBLIC_VIEW`(또는 숨김 업무의 경우 `WI_HIDDEN_VIEW`) 권한이 있거나 담당자 본인이어야 한다.
- `files` 는 파일 조회 권한이 없으면 빈 배열로 반환된다.