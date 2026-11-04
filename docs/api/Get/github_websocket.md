# GitHub 제어 및 실시간 이벤트 WebSocket api
- 클라이언트 및 VSCode 확장과 서버 간 양방향 채널을 유지하여, 브랜치 룸 입장/퇴장, 실시간 프레즌스(접속자 현황), 커밋/푸시/트리 변경 이벤트를 수신하는 WebSocket api
## Request

### 1. 연결 (Handshake)

| Method | Protocol | URL |
| :--- | :--- | :--- |
| Get (Upgrade) | WebSocket | wss://{서버 url}/api/github/ws |

- 인증 토큰은 URL 파라미터가 아닌 연결 후 첫 번째 메시지 프레임(auth)으로 전송합니다.

---

### 2. 인증 (첫 프레임 auth)

- 연결이 수립되면 클라이언트는 10초 이내에 auth 프레임을 전송해야 합니다.

```json
{
  "type": "auth",
  "token": "{JWT_ACCESS_TOKEN}",
  "client_id": "client-instance-123",
  "connection_id": "ws-custom-conn-id"
}
```

| 필드 | 타입 | 필수 여부 | 설명 |
| :--- | :--- | :--- | :--- |
| type | String | 필수 | "auth" (또는 "AUTH") 고정 |
| token | String | 필수 | JWT Access Token |
| client_id | String | 선택 | 클라이언트 인스턴스 식별자 |
| connection_id | String | 선택 | 재접속 시 접속자 행 승계를 위한 연결 식별자 |

---

### 3. 클라이언트 요청 메시지 종류

- **브랜치 입장 (`join`)**:
```json
{
  "type": "join",
  "repo_id": 1,
  "branch": "feature/login"
}
```

- **브랜치 전환 (`switch_branch`)**:
```json
{
  "type": "switch_branch",
  "repo_id": 1,
  "to": "main"
}
```

- **브랜치 퇴장 (`leave`)**:
```json
{
  "type": "leave",
  "repo_id": 1,
  "branch": "feature/login"
}
```

- **하트비트 (`heartbeat`)**: 접속자 행(`last_seen_at`) 갱신.
  - 평소에는 `connection_id` 행의 `last_seen_at` 만 갱신합니다.
  - 5분마다 저장소·브랜치·`GITHUB_VIEW` 권한을 다시 검증합니다. 권한 변경 통보를 놓친 연결은 이때 `P0103`/`P0815` 를 받고 종료됩니다.
  - 재접속 승계 등으로 접속자 행이 사라졌으면 전체 등록을 다시 수행합니다.
```json
{
  "type": "heartbeat"
}
```

- **핑 (`ping`)**: 연결 생존 확인
```json
{
  "type": "ping"
}
```

---

## Response

### 1. 인증 응답 (Server-to-Client)
- 성공:
```json
{
  "type": "AUTH_OK",
  "message": "GitHub 제어 소켓에 연결되었습니다."
}
```
- 실패:
```json
{
  "type": "AUTH_FAILED",
  "message": "유효하지 않거나 만료된 토큰입니다."
}
```

### 2. 서버 브로드캐스트 이벤트 종류
- **접속자 갱신 (`presence_updated`)**:
```json
{
  "type": "presence_updated",
  "repo_id": 1,
  "branch": "feature/login",
  "presence": [
    {
      "user_name": "홍길동",
      "email": "user@example.com"
    }
  ]
}
```
- **브랜치 생성/삭제 (`branch_created` / `branch_deleted`)**:
```json
{
  "type": "branch_created",
  "repo_id": 1,
  "branch": "feature/login"
}
```
- **커밋 시작/종료 (`commit_started` / `commit_finished`)**:
```json
{
  "type": "commit_started",
  "repo_id": 1,
  "branch": "feature/login",
  "email": "user@example.com"
}
```
- **푸시 완료 (`push_finished`)**:
```json
{
  "type": "push_finished",
  "repo_id": 1,
  "branch": "feature/login",
  "pushed": true,
  "ahead": 0
}
```
- **파일시스템 변경 (`file_created`, `file_moved`, `file_deleted`, `dir_created`, `worktree_changed`)**
- **강제 종료 (`repo_closed`)**: 저장소 연결 해제 또는 권한 상실 시

- 설명<br>
1. 저장소 및 브랜치 작업 시 다수의 사용자가 동일 브랜치를 편집할 때 충돌을 방지하고 상태를 실시간 동기화합니다.<br>
