# 실시간 알림 WebSocket 연결 api

- 클라이언트와 서버 간 실시간 양방향 통신 채널을 수립하여, 업무 배정, 변경 사항, 멘션 및 시스템 알림을 실시간으로 수신하는 WebSocket api

## Connection (Handshake)

### Request

| Method | Protocol | URL |
| :--- | :--- | :--- |
| Get (Upgrade) | WebSocket | ws://{서버 url}/api/notification/ws?token={JWT_ACCESS_TOKEN} |

---

### Query Parameters

| 파라미터 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| token | String | 필수 | 로그인 성공 시 발급받은 JWT Access Token |

---

## Response

### 1. Handshake 성공 시 (HTTP 101 Switching Protocols)
- WebSocket 연결 성공 직후 서버에서 초기 웰컴 메시지를 JSON으로 자동 발송

```json
{
  "type": "SYSTEM",
  "message": "Connected to real-time notification service."
}
```

---

### 2. 실시간 이벤트 수신 (Server-to-Client Push)
- 업무 배정, 댓글 등록, 상태 변경 등의 이벤트 발생 시 실시간으로 수신되는 메시지 형식

```json
{
  "type": "NOTIFICATION",
  "data": {
    "notification_id": 102,
    "user_id": "U-12",
    "title": "새로운 업무가 배정되었습니다.",
    "content": "홍길동님이 'UI 컴포넌트 리팩토링' 업무 담당자로 지정했습니다.",
    "link_url": "/work-items/WI-104",
    "is_read": false,
    "created_at": "2026-09-04T05:00:00.000000+00:00"
  }
}
```

---

### Message Elements

| 파라미터 | 타입 | 설명 |
| :--- | :--- | :--- |
| type | String | 메시지 종류 (SYSTEM, NOTIFICATION) |
| message | String | 시스템 안내 메시지 (type이 SYSTEM인 경우) |
| data | Object | 알림 상세 데이터 객체 (type이 NOTIFICATION인 경우) |
| data.notification_id | Integer | 알림 고유 식별 ID |
| data.user_id | String | 수신 대상 사용자 ID |
| data.title | String | 알림 제목 |
| data.content | String | 알림 내용 |
| data.link_url | String | 알림 클릭 시 이동 대상 URL |
| data.is_read | Boolean | 읽음 여부 |
| data.created_at | String | 알림 생성 일시 |
