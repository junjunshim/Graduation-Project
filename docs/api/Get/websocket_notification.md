# 실시간 알림 WebSocket 연결 api

- 클라이언트와 서버 간 양방향 채널을 유지하여, 업무 배정, 변경 사항, 멘션, 시스템 알림과 채널 사용자 현황을 실시간으로 수신하는 WebSocket api

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

### 3. 채널 사용자 현황 등록/해제 (Client-to-Server)

- 채널 화면에 들어가면 `CHANNEL_JOIN`, 다른 채널로 이동하거나 화면을 벗어나면 `CHANNEL_LEAVE` 를 전송한다.
- 서버는 `CHANNEL_VIEW` 권한(워크스페이스 채널) 또는 DM 참여자 여부를 확인한 뒤 해당 채널의 사용자 현황 방에 연결을 등록한다.

```json
{
  "type": "CHANNEL_JOIN",
  "channel_id": 12
}
```

```json
{
  "type": "CHANNEL_LEAVE",
  "channel_id": 12
}
```

| 필드 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | "CHANNEL_JOIN" 또는 "CHANNEL_LEAVE" |
| channel_id | Integer | 필수 | 사용자 현황 이벤트를 수신할 채널 ID |

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

### 4. 채널 사용자 현황 (Server-to-Client Push)

- 채널 화면에 입장한 연결에는 현재 사용자 현황 스냅샷을 보내고, 사용자의 앱 접속 상태가 바뀌면 해당 채널을 보고 있는 모든 연결에 갱신된 현황을 전송한다.
- `participants` 는 현재 화면을 보고 있는 사용자가 아니라 **해당 채널을 볼 수 있는 사용자 전체**다.
- `online` 은 채널 화면을 열었는지가 아니라, 사용자가 앱에서 인증된 WebSocket 연결을 하나 이상 유지하고 있는지를 뜻한다.
- 같은 이메일로 여러 창/기기가 접속해도 한 번만 표시하며, 하나라도 연결되어 있으면 `online: true` 다.

```json
{
  "type": "CHAT",
  "sub_type": "CHANNEL_PRESENCE",
  "data": {
    "channel_id": 12,
    "participants": [
      {
        "email": "user@example.com",
        "name": "김철수",
        "online": true
      }
    ]
  }
}
```

- 채널 조회 권한이 없거나 채널이 없으면 사용자 정보 대신 오류 이벤트를 전송한다.

```json
{
  "type": "CHAT",
  "sub_type": "CHANNEL_PRESENCE_ERROR",
  "data": {
    "channel_id": 12,
    "message": "채널 사용자 정보를 확인하지 못했습니다."
  }
}
```

---

### 5. 연결 유지 (PING / PONG)

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
| type | String | 메시지 종류 (AUTH, AUTH_OK, AUTH_FAILED, NOTIFICATION, CHAT, PING, PONG) |
| message | String | 처리 결과 안내 메시지 (AUTH_OK, AUTH_FAILED 인 경우) |
| sub_type | String | 세부 종류 (알림: ACTIVITY, MENTION / 채팅: CHANNEL_PRESENCE, CHANNEL_PRESENCE_ERROR) |
| data | Object | 상세 데이터 객체 (type 이 NOTIFICATION 또는 CHAT 인 경우) |
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
| data.channel_id | Integer | 사용자 현황을 전송한 채널 ID |
| data.participants | Array | 해당 채널을 볼 수 있는 사용자 전체 목록 (`CHANNEL_PRESENCE`) |
| data.participants[].email | String | 사용자 이메일 |
| data.participants[].name | String | 사용자 표시 이름 |
| data.participants[].online | Boolean | 앱에 인증된 WebSocket 연결이 하나 이상 살아 있는지 여부 |
| data.message | String | 사용자 정보 조회 실패 안내 (`CHANNEL_PRESENCE_ERROR`) |

---

## 정책

- 인증은 연결 후 첫 프레임(AUTH)으로 수행하며, Access Token 은 URL 에 포함하지 않는다.
- 하나의 계정은 여러 기기에서 동시에 연결할 수 있다. 서버는 `client_id` 단위로 연결을 관리한다.
- 같은 `client_id` 로 재연결하면 기존 연결은 서버가 종료하고 새 연결로 교체한다.
- 업무 상세 조회 권한이 없는 사용자에게는 마스킹된 알림(`can_view_detail: false`)이 전달된다.
- 숨김 처리된 업무는 열람 권한이 있는 사용자에게만 알림이 전달된다.
- 활동 로그 생성 시점에 서버가 수신자 목록을 확정하며, 알림은 서버에서 클라이언트로 단방향 푸시된다.
- 채널 사용자 목록은 `CHANNEL_JOIN` 한 연결에 대한 스냅샷과, 사용자 접속/종료 시점의 채널 방 전체 브로드캐스트로 전달된다.
- `CHANNEL_LEAVE` 는 해당 연결을 채널 이벤트 수신 대상에서 제거할 뿐, 사용자 목록이나 `online` 상태를 바꾸지 않는다.
- DM 은 두 참여자 중 상대방의 `online` 값을 사용해 화면에 접속 상태를 표시한다.
- 같은 사용자가 여러 창/기기로 접속해도 사용자 목록에는 이메일 기준으로 한 번만 표시된다.
- 채널을 보고 있는 연결이 없으면 전송할 수신자가 없으므로 이벤트를 만들지 않는다.
