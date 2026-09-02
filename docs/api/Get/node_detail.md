# node 상세 조회 api
- 특정 node의 상세 정보와 해당 node에 속한 모든 구성 요소(역할 배정 목록, 역할별 권한 정의, 소속 업무 목록, 업무에 첨부된 파일 목록, 해당 노드의 전체 활동 이력)를 통합 조회하는 api
## Request
- Request syntax
```json
{
}
```

| Method | URL |
| :--- | :--- |
| Get | http://{서버 url}/api/org/nodes?node_id=98 |

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
| node_id | Integer | 필수 | 조회할 node 식별 id |

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "data" : [
        {
            "type" : "NODE",
            "id" : 98,
            "node_type" : "DEPARTMENT",
            "parent_id" : 96,
            "title" : "애플 기획부",
            "path" : [96, 98],
            "is_deleted" : false,
            "updated_at" : "2026-09-02T08:54:49.604005+00:00"
        },
        {
            "type" : "ROLE",
            "id" : 209,
            "node_id" : 98,
            "email" : "apple_1dept_leader@apple.com",
            "role" : "ADMIN",
            "updated_at" : "2026-09-02T08:54:49.604005+00:00"
        },
        {
            "type" : "AUTHORITY",
            "id" : 389,
            "node_id" : 98,
            "role" : "ADMIN",
            "authority" : "011111111111111111111111",
            "updated_at" : "2026-09-02T08:54:49.604005+00:00"
        },
        {
            "type" : "WORK_ITEM",
            "id" : "WI-196",
            "parent_id" : "WI-194",
            "owner_node_id" : 98,
            "owner_user_id" : "U-163",
            "title" : "기획부 세부 구현 스프린트",
            "description" : "애플 기획부의 세부 마일스톤 기획 및 리소스 설계",
            "category" : "FEATURE",
            "status" : "todo",
            "priority" : 3,
            "hidden" : false,
            "weight" : 1,
            "progress" : 0,
            "comment_count" : 4,
            "is_deleted" : false,
            "start_date" : "2026-03-01",
            "due_date" : "2026-06-30",
            "updated_at" : "2026-09-02T08:54:49.604005+00:00"
        },
        {
            "type" : "FILE",
            "id" : 97,
            "work_item_id" : "WI-196",
            "uploader_user_id" : "U-163",
            "uploader_name" : "애플 기획부 팀장",
            "uploader_email" : "apple_1dept_leader@apple.com",
            "original_file_name" : "sprint_backlog.txt",
            "file_size" : 0,
            "mime_type" : "text/plain",
            "is_deleted" : false,
            "created_at" : "2026-09-02T08:54:49.604005+00:00",
            "updated_at" : "2026-09-02T08:54:49.604005+00:00"
        },
        {
            "type" : "ACTIVITY",
            "id" : 715,
            "node_id" : 98,
            "actor_user_id" : "U-163",
            "actor_name" : "애플 기획부 팀장",
            "entity_type" : "WORK_ITEM",
            "entity_id" : "WI-196",
            "target_name" : "기획부 세부 구현 스프린트",
            "action_type" : "inserted",
            "field_name" : null,
            "old_value" : null,
            "new_value" : null,
            "created_at" : "2026-09-02T08:54:49.604005+00:00"
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
| data | Array | 성공 | 조회 대상 노드의 메타데이터 및 소속 역할, 권한, 업무, 파일, 활동 이력 데이터 통합 리스트 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 (NODE, ROLE, AUTHORITY, WORK_ITEM, FILE, ACTIVITY) |
| id | String or Integer | 필수 | 데이터 식별 id (NODE/ROLE/AUTHORITY/FILE/ACTIVITY: Integer, WORK_ITEM: String) |
| node_type | String | node | 노드의 타입 |
| parent_id | String or Integer or Null | node, work_item | 상위 식별 id (노드는 Integer, 업무는 String) |
| title | String | node, work_item | 노드 이름 또는 업무 제목 |
| path | Array | node | 노드의 계층 경로 배열 |
| is_deleted | Boolean | node, work_item, file | 삭제 여부 |
| email | String | role | 역할이 배정된 사용자 이메일 |
| role | String | role, authority | 역할 이름 (ADMIN, MANAGER, MEMBER 등) |
| authority | String | authority | 24비트 권한 문자열 |
| owner_node_id | Integer | work_item | 업무 소속 노드 id |
| owner_user_id | String | work_item | 업무 담당자 사용자 id |
| description | String or Null | work_item | 업무 설명 |
| category | String or Null | work_item | 업무 카테고리 |
| status | String | work_item | 업무 상태값 |
| priority | Integer | work_item | 업무 우선순위 |
| hidden | Boolean | work_item | 업무 숨김 여부 |
| weight | Integer | work_item | 업무 가중치 |
| progress | Integer | work_item | 업무 진행률 |
| comment_count | Integer | work_item | 업무 댓글 수 |
| start_date | String or Null | work_item | 업무 시작 일자 |
| due_date | String or Null | work_item | 업무 마감 일자 |
| work_item_id | String | file | 첨부된 업무 ID |
| uploader_user_id | String | file | 파일 업로더 사용자 ID |
| uploader_name | String | file | 파일 업로더 이름 |
| uploader_email | String | file | 파일 업로더 이메일 |
| original_file_name | String | file | 원본 파일명 |
| file_size | Integer | file | 파일 크기 (Bytes) |
| mime_type | String | file | 파일 MIME 타입 |
| node_id | Integer | role, authority, activity | 소속 노드 ID |
| actor_user_id | String | activity | 활동 수행자 ID |
| actor_name | String | activity | 활동 수행자 이름 |
| entity_type | String | activity | 활동 대상 객체 종류 ('NODE', 'WORK_ITEM', 'ROLE', 'AUTHORITY', 'COMMENT') |
| entity_id | String | activity | 활동 대상 객체 ID |
| target_name | String | activity | 대상 객체 명칭 |
| action_type | String | activity | 활동 종류 ('inserted', 'updated', 'deleted', 'restored') |
| field_name | String or Null | activity | 변경된 필드명 |
| old_value | String or Null | activity | 변경 이전 값 |
| new_value | String or Null | activity | 변경 이후 값 |
| created_at | String | file, activity | 생성 일시 |
| updated_at | String | node, role, authority, work_item, file | 최신 수정 일시 |
