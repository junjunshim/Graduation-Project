# 📄 노드 상세 조회 API

- **HTTP Method** : GET
- **API Path** : `/api/org/nodes?node_id={node_id}`
- **인증 방식** : Bearer Token (JWT)

---

## 1. 개요
특정 노드(`node_id`)의 메타데이터 및 해당 노드에 속한 모든 구성 요소(**역할 배정 목록, 역할별 권한 정의, 소속 업무 목록, 업무에 첨부된 파일 목록, 해당 노드의 전체 활동 이력**)를 평면 배열(`integrated_data`) 형식으로 통합 반환합니다.

---

## 2. 요청 파라미터 (Query Parameter)

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| `node_id` | Integer | 필수 | 상세 조회할 대상 노드의 식별 ID |

- Request Example
```http
GET /api/org/nodes?node_id=98 HTTP/1.1
Host: localhost:8080
Authorization: Bearer {Access_Token}
Accept-Encoding: gzip, deflate, br
```

---

## 3. 응답 규격 (Response Syntax)

### 성공 응답 (200 OK)
```json
{
    "status": "success",
    "data": [
        {
            "type": "NODE",
            "id": 98,
            "node_type": "DEPARTMENT",
            "parent_id": 96,
            "title": "애플 기획부",
            "path": [96, 98],
            "updated_at": "2026-09-02T08:54:49.604005+00:00"
        },
        {
            "type": "ROLE",
            "id": 209,
            "node_id": 98,
            "email": "apple_1dept_leader@apple.com",
            "role": "ADMIN",
            "updated_at": "2026-09-02T08:54:49.604005+00:00"
        },
        {
            "type": "AUTHORITY",
            "id": 389,
            "node_id": 98,
            "role": "ADMIN",
            "authority": "011111111111111111111111",
            "updated_at": "2026-09-02T08:54:49.604005+00:00"
        },
        {
            "type": "WORK_ITEM",
            "id": "WI-196",
            "parent_id": "WI-194",
            "owner_node_id": 98,
            "owner_user_id": "U-163",
            "title": "기획부 세부 구현 스프린트",
            "description": "애플 기획부의 세부 마일스톤 기획 및 리소스 설계",
            "category": "FEATURE",
            "status": "todo",
            "priority": 3,
            "hidden": false,
            "weight": 1,
            "progress": 0,
            "comment_count": 4,
            "start_date": "2026-03-01",
            "due_date": "2026-06-30",
            "updated_at": "2026-09-02T08:54:49.604005+00:00"
        },
        {
            "type": "FILE",
            "id": 97,
            "work_item_id": "WI-196",
            "uploader_user_id": "U-163",
            "uploader_name": "애플 기획부 팀장",
            "uploader_email": "apple_1dept_leader@apple.com",
            "original_file_name": "sprint_backlog.txt",
            "file_size": 0,
            "mime_type": "text/plain",
            "created_at": "2026-09-02T08:54:49.604005+00:00",
            "updated_at": "2026-09-02T08:54:49.604005+00:00"
        },
        {
            "type": "ACTIVITY",
            "id": 715,
            "node_id": 98,
            "actor_user_id": "U-163",
            "actor_name": "애플 기획부 팀장",
            "entity_type": "WORK_ITEM",
            "entity_id": "WI-196",
            "target_name": "기획부 세부 구현 스프린트",
            "action_type": "inserted",
            "field_name": null,
            "old_value": null,
            "new_value": null,
            "created_at": "2026-09-02T08:54:49.604005+00:00"
        }
    ]
}
```

### 실패 응답 예시
```json
{
    "status": "error",
    "code": "403",
    "message": "[P0103]Insufficient permissions to view node. NODE_INFO_VIEW authority required. requester: test@apple.com"
}
```

---

## 4. 응답 필드 설명 (Data Elements)

| 엔티티 타입 (`type`) | 주요 필드 | 설명 |
| :--- | :--- | :--- |
| **`NODE`** | `id`, `node_type`, `parent_id`, `title`, `path`, `updated_at` | 조회 대상 노드 자체의 상세 정보 |
| **`ROLE`** | `id`, `node_id`, `email`, `role`, `updated_at` | 노드에 배정된 멤버 및 역할 목록 (`NODE_MEMBERS_VIEW` 권한 필요) |
| **`AUTHORITY`** | `id`, `node_id`, `role`, `authority`, `updated_at` | 노드 내 정의된 역할별 24비트 권한 비트마스크 |
| **`WORK_ITEM`** | `id`, `parent_id`, `owner_node_id`, `owner_user_id`, `title`, `description`, `category`, `status`, `priority`, `hidden`, `weight`, `progress`, `comment_count`, `start_date`, `due_date`, `updated_at` | 노드 소속 업무 목록 (댓글 개수 `comment_count` 포함, 공개/숨김 권한에 따라 필터링) |
| **`FILE`** | `id`, `work_item_id`, `uploader_user_id`, `uploader_name`, `uploader_email`, `original_file_name`, `file_size`, `mime_type`, `created_at`, `updated_at` | 노드 소속 업무들에 첨부된 파일 목록 (`FILE_VIEW` 권한 필요) |
| **`ACTIVITY`** | `id`, `node_id`, `actor_user_id`, `actor_name`, `entity_type`, `entity_id`, `target_name`, `action_type`, `field_name`, `old_value`, `new_value`, `created_at` | 해당 노드에서 발생한 활동 로그 전체 목록 (`HISTORY_ALL_VIEW` 또는 `HISTORY_PERSONAL_VIEW`) |

---

## 5. 에러 코드 매핑

| 에러 코드 | HTTP 상태 코드 | 원인 및 해결 방법 |
| :--- | :--- | :--- |
| `P0001` | 404 Not Found | 요청자 계정이 DB에 존재하지 않음 |
| `P0002` | 404 Not Found | 대상 `node_id`가 존재하지 않거나 삭제됨 |
| `P0103` | 403 Forbidden | 해당 노드에 대한 `NODE_INFO_VIEW` 권한이 없거나 `DENY` 상태임 |
| `P0305` | 500 Internal Server Error | 노드 상세 조회 도중 DB 오류 발생 |
