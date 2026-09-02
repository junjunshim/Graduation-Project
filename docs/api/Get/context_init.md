# 사용자 전체 정보 조회 api
- 사용자가 속한 노드와 해당 노드의 모든 work_item를 조회하는 api
## Request
- Request syntax
```json
{
}
```

| Method | URL |
| :--- | :--- |
| Get | http://{서버 url}/api/context/init |

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

---

## Response
- Response Syntax
```json
{
    "status" : "success",
    "server_time" : "2026-03-19 12:29:24.745634+00",
    "data" : [
        {
            "type" : "NODE",
            "id" : 4,
            "node_type" : "DEPARTMENT",
            "parent_id" : 1,
            "title" : "개발 부서",
            "path" : [1, 4],
            "updated_at" : "2026-03-19 12:29:24.745634+00"
        },
        {
            "type" : "WORK_ITEM",
            "id" : "WI-1101",
            "parent_id" : "WI-110",
            "owner_node_id" : 10,
            "owner_user_id" : "U-12",
            "title" : "테스트 work_item",
            "description" : "테스트용 work_item",
            "category" : "FEATURE",
            "status" : "todo",
            "priority" : 3,
            "hidden" : false,
            "weight" : 1,
            "progress" : 0,
            "comment_count" : 2,
            "start_date" : "2026-03-01",
            "due_date" : "2026-03-31",
            "updated_at" : "2026-03-19 12:29:24.745634+00"
        },
        {
            "type" : "ROLE",
            "id" : 20,
            "node_id" : 4,
            "email" : "test1234@gmail.com",
            "role" : "ADMIN",
            "updated_at" : "2026-03-19 12:29:24.745634+00"
        },
        {
            "type" : "AUTHORITY",
            "id" : 2,
            "node_id" : 4,
            "role" : "ADMIN",
            "authority" : "011111111111111111111111",
            "updated_at" : "2026-03-19 12:29:24.745634+00"
        },
        {
            "type": "MENTION",
            "id": 12,
            "comment_id": 101,
            "work_item_id": "WI-100",
            "message": "홍길동님이 댓글에서 회원님을 멘션했습니다.",
            "is_read": false,
            "created_at": "2026-03-19 12:29:24.745634+00",
            "updated_at": "2026-03-19 12:29:24.745634+00"
        },
        {
            "type": "ACTIVITY",
            "id": 501,
            "node_id": 4,
            "actor_user_id": "U-12",
            "actor_name": "홍길동",
            "entity_type": "WORK_ITEM",
            "entity_id": "WI-1101",
            "target_name": "테스트 work_item",
            "action_type": "updated",
            "field_name": "status",
            "old_value": "todo",
            "new_value": "in_progress",
            "created_at": "2026-03-19 12:29:24.745634+00"
        },
        {
            "type": "FILE",
            "id": 77,
            "work_item_id": "WI-1101",
            "uploader_user_id": "U-12",
            "uploader_name": "홍길동",
            "uploader_email": "test1234@gmail.com",
            "original_file_name": "architecture_diagram.png",
            "file_size": 2048576,
            "mime_type": "image/png",
            "created_at": "2026-03-19 12:20:00.000000+00",
            "updated_at": "2026-03-19 12:20:00.000000+00"
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
| server_time | String | 성공 | 서버의 현재 시간 (이후 증분 동기화 `last_synced_at` 파라미터로 사용) |
| data | Array | 성공 | 사용자가 속한 조직 구조, 업무, 역할, 권한, 멘션 알림, 최근 활동(최대 5개), 최근 파일(최대 5개) 데이터 통합 리스트 |
| message | String | 에러 | 요청 관련 메세지 |

- Data Elements

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | 데이터의 타입 (NODE, WORK_ITEM, ROLE, AUTHORITY, MENTION, ACTIVITY, FILE) |
| id | String or Integer | 필수 | 데이터 식별 id (NODE/ROLE/AUTHORITY/MENTION/ACTIVITY/FILE: Integer, WORK_ITEM: String) |
| node_type | String | node | 노드의 타입 |
| parent_id | String or Integer or Null | node, work_item | 상위 식별 id (노드는 Integer, 업무는 String) |
| title | String | node, work_item | 노드 이름 또는 업무 제목 |
| path | Array | node | 노드의 계층 경로 배열 |
| owner_node_id | Integer | work_item | 업무 소속 노드 id |
| owner_user_id | String | work_item | 업무 담당자 사용자 id |
| description | String or Null | work_item | 업무 설명 |
| category | String or Null | work_item | 업무 카테고리 |
| status | String | work_item, role, authority, node, file | 상태값 |
| priority | Integer | work_item | 업무 우선순위 |
| hidden | Boolean | work_item | 업무 숨김 여부 |
| weight | Integer | work_item | 업무 가중치 |
| progress | Integer | work_item | 업무 진행률 |
| comment_count | Integer | work_item | 업무에 등록된 댓글 총 개수 |
| start_date | String or Null | work_item | 업무 시작 일자 |
| due_date | String or Null | work_item | 업무 마감 일자 |
| node_id | Integer | role, authority, activity | 소속 노드의 id |
| email | String | role | 역할이 배정된 사용자 이메일 |
| role | String | role, authority | 역할 이름 (ADMIN, MANAGER, MEMBER 등) |
| authority | String | authority | 24비트 권한 문자열 |
| comment_id | Integer | mention | 멘션이 발생한 댓글 식별 ID |
| work_item_id | String | mention, file | 연관된 업무 식별 ID |
| message | String | mention | 멘션 알림 메시지 내용 |
| is_read | Boolean | mention | 알림 읽음 상태 여부 |
| actor_user_id | String | activity | 활동을 수행한 사용자 ID |
| actor_name | String | activity | 활동을 수행한 사용자 이름 |
| entity_type | String | activity | 활동 대상 객체 종류 ('NODE', 'WORK_ITEM', 'ROLE', 'AUTHORITY', 'COMMENT') |
| entity_id | String | activity | 활동 대상 고유 ID |
| target_name | String | activity | 활동 대상 명칭 (업무명, 노드명 등) |
| action_type | String | activity | 수행된 작업 ('inserted', 'updated', 'deleted', 'restored') |
| field_name | String or Null | activity | 변경된 필드명 (예: 'status', 'title' 등) |
| old_value | String or Null | activity | 변경 전 값 |
| new_value | String or Null | activity | 변경 후 값 |
| uploader_user_id | String | file | 파일 업로더 사용자 ID |
| uploader_name | String | file | 파일 업로더 사용자 이름 |
| uploader_email | String | file | 파일 업로더 이메일 |
| original_file_name | String | file | 원본 파일명 |
| file_size | Integer | file | 파일 크기 (Bytes) |
| mime_type | String or Null | file | 파일 MIME 타입 |
| created_at | String | mention, activity, file | 데이터 생성 일시 |
| updated_at | String | 필수(activity 제외) | 데이터의 최신 업데이트 시간 |

- 설명<br>
1. 기본적으로 데이터는 평면 리스트 형태로 제공, 프론트에서 트리형태로 변환하는 로직이 필요<br>
2. ACTIVITY와 FILE 데이터는 초기 대시보드 화면 렌더링을 위해 접근 권한이 있는 최신 5개 항목만 반환됩니다.<br>