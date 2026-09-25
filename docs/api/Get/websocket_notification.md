# 실시간 알림 WebSocket 연결 api

- 클라이언트와 서버 간 양방향 채널을 유지하여, 업무 배정, 변경 사항, 멘션 및 시스템 알림을 실시간으로 수신하는 WebSocket api

## Request

### 1. 연결 (Handshake)

| Method | Protocol | URL |
| :--- | :--- | :--- |
| Get (Upgrade) | WebSocket | wss://{서버 url}/api/notification/ws |

- 운영 환경은 HTTPS 이므로 `wss://{서버 url}/api/notification/ws` 로 연결한다. 평문 HTTP 로 띄운 로컬 개발 서버에 붙을 때만 `ws://` 를 쓴다.
- 인증 토큰은 URL 쿼리 파라미터로 전달하지 않는다. 연결 후 첫 프레임으로 전송한다.

---

### 2. 인증 (첫 프레임 AUTH)

- WebSocket 연결이 열리면(HTTP 101 Switching Protocols) 클라이언트는 첫 번째 프레임으로 AUTH 메시지를 전송한다.
- 서버는 AUTH 메시지를 받기 전까지 해당 연결을 알림 수신 대상에 등록하지 않으며, AUTH 외의 프레임이 먼저 도착하면 연결을 종료한다.
- 연결 후 10초 이내에 AUTH 메시지가 도착하지 않으면 서버가 연결을 종료한다.

```json
{
  "type": "AUTH",
  "token": "{JWT_ACCESS_TOKEN}",
  "client_id": "{CLIENT_ID}"
}
```

| 필드 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | "AUTH" 고정 |
| token | String | 필수 | 로그인 성공 시 발급받은 JWT Access Token |
| client_id | String | 선택 | 클라이언트 인스턴스 식별자. 같은 값으로 재연결하면 서버가 이전 연결을 교체한다. |

---

## Response

### 1. 인증 성공 (Server-to-Client)

```json
{
  "type": "AUTH_OK",
  "message": "Connected to real-time notification service."
}
```

---

### 2. 인증 실패 (Server-to-Client)

```json
{
  "type": "AUTH_FAILED",
  "message": "Invalid or expired access token."
}
```

- 인증 실패 메시지를 전송한 뒤 서버가 연결을 종료한다.
- 클라이언트는 토큰을 재발급받은 뒤 재연결한다.

---

### 3. 실시간 이벤트 수신 (Server-to-Client Push)

- 업무 배정, 댓글 등록, 상태 변경 등의 이벤트가 발생하면 실시간으로 수신하는 메시지 형식

```json
{
  "type": "NOTIFICATION",
  "sub_type": "ACTIVITY",
  "data": {
    "notification_id": 102,
    "node_id": 7,
    "entity_type": "WORK_ITEM",
    "entity_id": "WI-104",
    "work_item_id": "WI-104",
    "action": "updated",
    "is_recurring_file": false,
    "actor_user_id": "U-12",
    "actor_name": "김철수",
    "title": "업무 알림",
    "target_name": "UI 컴포넌트 리팩터링",
    "field_name": "status",
    "old_value": "in_progress",
    "new_value": "done",
    "link_url": "/work-items/WI-104",
    "is_read": false,
    "created_at": "2026-09-04T05:00:00.000000Z",
    "can_view_detail": true
  }
}
```

---

### 4. 연결 유지 (PING / PONG)

- 클라이언트는 15초 주기로 PING 을 전송하고, 서버는 PONG 으로 응답한다.

```json
{
  "type": "PING"
}
```

```json
{
  "type": "PONG"
}
```

---

### Message Elements

| 파라미터 | 타입 | 설명 |
| :--- | :--- | :--- |
| type | String | 메시지 종류 (AUTH, AUTH_OK, AUTH_FAILED, NOTIFICATION, PING, PONG) |
| message | String | 처리 결과 안내 메시지 (AUTH_OK, AUTH_FAILED 인 경우) |
| sub_type | String | 알림 세부 종류 (ACTIVITY, MENTION) |
| data | Object | 알림 상세 데이터 객체 (type 이 NOTIFICATION 인 경우) |
| data.notification_id | Integer | 알림 고유 식별 ID |
| data.node_id | Integer | 알림이 발생한 노드 ID |
| data.entity_type | String | 알림 대상 종류 (NODE, WORK_ITEM, COMMENT, FILE, ROLE, AUTHORITY, RECURRING_RULE) |
| data.entity_id | String | 알림 대상 고유 ID |
| data.work_item_id | String | 연결된 업무 ID (업무/댓글/파일 알림인 경우) |
| data.action | String | 수행된 동작 (inserted, updated, deleted, restored) |
| data.is_recurring_file | Boolean | 일정(정기 규칙) 전용 파일 알림 여부 |
| data.actor_user_id | String | 동작을 수행한 사용자 ID |
| data.actor_name | String | 동작을 수행한 사용자 이름 |
| data.title | String | 알림 제목 |
| data.target_name | String | 알림 대상 대표 명칭 |
| data.field_name | String | 변경된 필드명 (null 가능) |
| data.old_value | String | 이전 값 (null 가능) |
| data.new_value | String | 변경된 값 (null 가능) |
| data.link_url | String | 알림 클릭 시 이동 대상 경로 |
| data.is_read | Boolean | 읽음 여부 |
| data.created_at | String | 알림 생성 일시 (UTC) |
| data.can_view_detail | Boolean | 업무 상세 조회 권한 보유 여부 |

---

## 정책

- 인증은 연결 후 첫 프레임(AUTH)으로 수행하며, Access Token 은 URL 에 포함하지 않는다.
- 하나의 계정은 여러 기기에서 동시에 연결할 수 있다. 서버는 `client_id` 단위로 연결을 관리한다.
- 같은 `client_id` 로 재연결하면 기존 연결은 서버가 종료하고 새 연결로 교체한다.
- 업무 상세 조회 권한이 없는 사용자에게는 마스킹된 알림(`can_view_detail: false`)이 전달된다.
- 숨김 처리된 업무는 열람 권한이 있는 사용자에게만 알림이 전달된다.
- 활동 로그 생성 시점에 서버가 수신자 목록을 확정하며, 알림은 서버에서 클라이언트로 단방향 푸시된다.