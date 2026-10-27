# 🔄 시스템 시퀀스 다이어그램 명세서 (System Sequence Diagrams)
**"AxisFlow 플랫폼의 도메인별 세부 상호작용 및 데이터 흐름"**

본 문서는 데스크톱 클라이언트(Electron/React), VSCode 확장 프로그램, 백엔드 서버(C++ Drogon), 실시간 문서 협업 사이드카(Node.js Yjs), PostgreSQL 데이터베이스 및 외부 서비스 간의 상호작용 흐름을 도메인별 시퀀스 다이어그램으로 상세히 기술합니다.

---

## 목차
1. [인증 및 계정 관리 (Authentication & User)](#1-인증-및-계정-관리-authentication--user)
   - 1.1. 이메일 인증 기반 회원가입 흐름
   - 1.2. 로그인 및 대시보드 컨텍스트 초기화
   - 1.3. 무중단 JWT 토큰 갱신 (Token Refresh)
   - 1.4. 비밀번호 재설정 (보안 링크 & 토큰 해시 소비)
2. [조직 및 노드 트리 관리 (Organization & Nodes)](#2-조직-및-노드-트리-관리-organization--nodes)
   - 2.1. 최상위/하위 노드 생성 및 Path 자동 계산
   - 2.2. 노드 트리 이동 (Move Preview & 순환 참조 방지 이전)
   - 2.3. 노드 소프트 삭제 및 연쇄 비활성화 / 복구 무결성 검증
3. [역할 및 권한 관리 (Role & Authority)](#3-역할-및-권한-관리-role--authority)
   - 3.1. 32비트 비트마스크 기반 커스텀 역할 생성 및 권한 검증
   - 3.2. 역할 회수 사전 검사 (Removal Preview) 및 회수 처리
4. [업무 및 진행률 라이프사이클 (WorkItem & Tasks)](#4-업무-및-진행률-라이프사이클-workitem--tasks)
   - 4.1. 업무 생성 및 가중치(Weight) 설정
   - 4.2. 하위 업무 완료 시 상위 프로젝트 진행률 자동 롤업 (Roll-up)
   - 4.3. 업무 댓글 작성 및 멘션 실시간 웹소켓 알림
5. [정기 루틴 및 반복 업무 (Recurring Rules)](#5-정기-루틴-및-반복-업무-recurring-rules)
   - 5.1. 정기 루틴 규칙 등록 및 WorkItem 자동 발급
6. [실시간 채팅 및 채널 (Chat & Messaging)](#6-실시간-채팅-및-채널-chat--messaging)
   - 6.1. 워크스페이스 채널 / 1:1 DM 생성 및 메시징
   - 6.2. 1-Depth 스레드 답글 및 Unread 카운트 갱신
7. [GitHub 연동 및 VSCode IDE 협업 (GitHub & IDE Integration)](#7-github-연동-및-vscode-ide-협업-github--ide-integration)
   - 7.1. GitHub 저장소 연동 및 로컬 클론/Worktree 준비
   - 7.2. 앱 ↔ VSCode Extension 원클릭 핸드오프 (Handoff Code)
   - 7.3. 실시간 동시 편집 (CRDT Y.Doc) 및 Worktree 원자적 파일 플러시
   - 7.4. 웹 브라우저/앱 내 Git 스테이징, 커밋 및 원격 Push

---

## 1. 인증 및 계정 관리 (Authentication & User)

### 1.1. 이메일 인증 기반 회원가입 흐름
이메일 인증코드 발송 → bcrypt 해시 검증 → 1회용 회원가입 검증 토큰 발급 → 최종 가입 시 독립 `USER` 노드 생성까지의 흐름입니다.

```mermaid
sequenceDiagram
    autonumber
    actor User as 사용자
    participant Client as 데스크톱 앱
    participant Server as Drogon Backend
    participant Mail as Mail Service (Resend)
    participant DB as PostgreSQL

    User->>Client: 이메일 입력 후 [인증번호 요청]
    Client->>Server: POST /api/users/email-verification/request {email}
    Server->>DB: 기존 가입 여부 및 최근 요청 쿨다운(60초) 검증
    Server->>Server: 6자리 난수 인증코드 생성 및 bcrypt 해싱
    Server->>DB: INSERT INTO signup_email_verifications (email, code_hash, code_expires_at)
    Server->>Mail: 비동기 인증 이메일 발송 요청
    Mail-->>User: 인증코드 수신 (예: 849201)
    Server-->>Client: 200 OK (쿨다운 시간 안내)

    User->>Client: 인증코드 입력 후 [인증 확인]
    Client->>Server: POST /api/users/email-verification/confirm {email, code}
    Server->>DB: 활성 인증 레코드 조회 (attempts 체크)
    Server->>Server: bcrypt.verify(code, code_hash)
    Server->>Server: 1회용 verification_token (SHA-256) 생성
    Server->>DB: UPDATE signup_email_verifications (verified_at, token_hash)
    Server-->>Client: 200 OK {verification_token}

    User->>Client: 이름, 비밀번호 입력 후 [가입 완료]
    Client->>Server: POST /api/users/signup {email, name, password, verification_token}
    Server->>DB: verification_token 일치 및 미소비(consumed_at IS NULL) 검증
    Server->>DB: 1) INSERT INTO organization_nodes (node_type: 'USER', name: '홍길동') -> node_id=999
    Server->>DB: 2) INSERT INTO users (user_id, email, password_hash, personal_node_id=999)
    Server->>DB: 3) INSERT INTO role_assignments (user_id, node_id=999, role_id=ADMIN)
    Server->>DB: 4) UPDATE signup_email_verifications SET consumed_at = NOW()
    Server-->>Client: 201 Created (가입 성공)
```

---

### 1.2. 로그인 및 대시보드 컨텍스트 초기화
로그인 성공 후 발급된 JWT로 사용자의 노드 트리, 비트마스크 권한, 초기 요약 통계를 단일 통합 API(`context/init`)로 가져옵니다.

```mermaid
sequenceDiagram
    autonumber
    actor User as 사용자
    participant Client as 데스크톱 앱
    participant Server as Drogon Backend
    participant DB as PostgreSQL

    User->>Client: 이메일/비밀번호 입력 후 로그인
    Client->>Server: POST /api/users/login {email, password}
    Server->>DB: SELECT * FROM users WHERE email = ? AND NOT is_deleted
    Server->>Server: 비밀번호 Argon2/Bcrypt 검증
    Server->>Server: Access Token (JWT, 15분) 및 Refresh Token 생성
    Server->>DB: INSERT/UPDATE user_refresh_tokens (user_email, refresh_token, expires_at)
    Server-->>Client: 200 OK {accessToken, refreshToken, user: {...}}

    Client->>Server: GET /api/context/init (Authorization: Bearer <accessToken>)
    Server->>DB: SELECT * FROM get_user_context_init(user_id)
    Note over DB: 1) 사용자 소속 모든 노드 및 조상/자손 트리 탐색<br/>2) 각 노드별 32비트 유효 권한 비트마스크 계산<br/>3) 개인/팀 미완료 업무 및 통계 JSONB 빌드
    DB-->>Server: context JSON 반환
    Server-->>Client: 200 OK {user, nodes, permissions, dashboardOverview}
    Client->>User: 대시보드 및 좌측 조직도 사이드바 화면 렌더링
```

---

### 1.3. 무중단 JWT 토큰 갱신 (Token Refresh)
Access Token 만료(`401 Unauthorized`) 시 백그라운드 Axios 인터셉터를 통해 토큰을 회전(Rotate)합니다.

```mermaid
sequenceDiagram
    autonumber
    participant Client as 데스크톱 앱 (Axios Interceptor)
    participant Server as Drogon Backend
    participant DB as PostgreSQL

    Client->>Server: GET /api/workItems (만료된 Access Token)
    Server-->>Client: 401 Unauthorized (Token Expired)

    Note over Client: 요청 대기열 큐잉 후 토큰 재발급 트리거
    Client->>Server: POST /api/users/refresh {refreshToken}
    Server->>DB: SELECT * FROM user_refresh_tokens WHERE refresh_token = ?
    alt 토큰 유효 및 만료 전
        Server->>Server: 신규 Access Token & 신규 Refresh Token 발급 (회전)
        Server->>DB: UPDATE user_refresh_tokens SET refresh_token = ?, expires_at = ?
        Server-->>Client: 200 OK {accessToken, refreshToken}
        Client->>Server: GET /api/workItems (새 Access Token으로 재요청)
        Server-->>Client: 200 OK {data: [...]}
    else 토큰 만료 또는 불일치
        Server-->>Client: 401 Unauthorized (Invalid Refresh Token)
        Client->>Client: 로컬 세션 클리어 및 로그인 화면으로 리다이렉트
    end
```

---

### 1.4. 비밀번호 재설정 (Password Reset)

```mermaid
sequenceDiagram
    autonumber
    actor User as 사용자
    participant Client as 데스크톱 앱
    participant Server as Drogon Backend
    participant Mail as Mail Service
    participant DB as PostgreSQL

    User->>Client: 비밀번호 찾기 이메일 제출
    Client->>Server: POST /api/users/password-reset/request {email}
    Server->>DB: 시간당 요청 제한(3회) 및 사용자 확인
    Server->>Server: 원문 난수 토큰 생성 (rawToken) & SHA-256 해싱 (tokenHash)
    Server->>DB: INSERT INTO password_reset_tokens (user_email, token_hash, expires_at)
    Server->>Mail: 재설정 링크 발송 (URL?token=rawToken)
    Server-->>Client: 200 OK (발송 완료 안내)

    User->>Client: 메일 링크 클릭 후 신규 비밀번호 입력
    Client->>Server: POST /api/users/password-reset/confirm {token, newPassword}
    Server->>Server: tokenHash = sha256(token)
    Server->>DB: SELECT * FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL
    alt 토큰 유효
        Server->>DB: 1) UPDATE users SET password_hash = newHash<br/>2) UPDATE password_reset_tokens SET used_at = NOW()<br/>3) DELETE FROM user_refresh_tokens (모든 기기 강제 로그아웃)
        Server-->>Client: 200 OK (비밀번호 변경 성공)
    else 토큰 만료/불일치
        Server-->>Client: 400 Bad Request (유효하지 않거나 만료된 링크)
    end
```

---

## 2. 조직 및 노드 트리 관리 (Organization & Nodes)

### 2.1. 최상위/하위 노드 생성 및 Path 자동 계산
노드 생성 시 부모의 `path` 배열을 이어받아 Materialized Path(`INTEGER[]`)를 자동으로 완성합니다.

```mermaid
sequenceDiagram
    autonumber
    actor Admin as 관리자
    participant Client as 데스크톱 앱
    participant Server as Drogon Backend
    participant DB as PostgreSQL (Function)

    Admin->>Client: 하위 부서/팀 생성 클릭 (부모: 백엔드부서 ID=100)
    Client->>Server: POST /api/org/subNodes {parentId: 100, name: "API팀", nodeType: "TEAM"}
    Server->>Server: 권한 검증 (NODE_SUB_CREATE 비트 확인)
    Server->>DB: SELECT * FROM create_sub_node(100, 'API팀', 'TEAM', actor_id)
    Note over DB: 1) 부모 노드(100)의 path={100} 조회<br/>2) 신규 노드 INSERT (node_id=200)<br/>3) path = {100, 200} 자동 생성<br/>4) 기본 역할/권한(role_authorities) 상속 복제<br/>5) 생성자에게 관리자 권한 매핑<br/>6) activity_logs 기록
    DB-->>Server: 신규 노드 레코드 반환
    Server-->>Client: 201 Created {node: {node_id: 200, path: [100, 200], ...}}
    Server-)Client: WebSocket 브로드캐스트 (노드 트리 실시간 추가 이벤트)
```

---

### 2.2. 노드 트리 이동 (Move Preview & 순환 참조 방지 이전)
노드를 다른 상위 노드 밑으로 이동할 때 순환 참조(자기 자신이나 자손을 부모로 지정) 여부를 사전에 검사한 뒤 일괄 이전합니다.

```mermaid
sequenceDiagram
    autonumber
    actor Admin as 관리자
    participant Client as 데스크톱 앱
    participant Server as Drogon Backend
    participant DB as PostgreSQL

    Admin->>Client: [노드 이전] 모달 열기 (대상: 노드 200 -> 목적지: 노드 300)
    Client->>Server: POST /api/org/nodes/move-preview {nodeId: 200, targetParentId: 300}
    Server->>DB: SELECT * FROM preview_node_move(200, 300)
    Note over DB: 1) targetParentId(300)가 nodeId(200)의 자손인지 path 검사<br/>2) 순환 참조 여부, 영향받는 하위 노드 수, 권한 변경 대상자 산출
    DB-->>Server: 검사 결과 반환 (is_valid: true, affected_nodes: 5)
    Server-->>Client: 200 OK (사전 확인 데이터 및 경고 표시)

    Admin->>Client: [이전 확정] 클릭
    Client->>Server: PATCH /api/org/nodes/move {nodeId: 200, targetParentId: 300}
    Server->>DB: SELECT * FROM execute_node_move(200, 300, actor_id)
    Note over DB: 1) targetParentId 락 획득 (SELECT FOR UPDATE)<br/>2) 200 노드 및 모든 하위 노드의 path 배열 재계산 UPDATE<br/>3) activity_logs 에 이전 내역 기록
    DB-->>Server: 이전 완료
    Server-->>Client: 200 OK (변경된 노드 서브트리 반환)
    Server-)Client: WebSocket 브로드캐스트 (트리 재배치 알림)
```

---

### 2.3. 노드 소프트 삭제 및 연쇄 비활성화 / 복구 무결성 검증

```mermaid
sequenceDiagram
    autonumber
    actor Admin as 관리자
    participant Client as 데스크톱 앱
    participant Server as Drogon Backend
    participant DB as PostgreSQL (Triggers)

    Admin->>Client: 노드 삭제 요청 (nodeId: 200)
    Client->>Server: DELETE /api/org/nodes?nodeId=200
    Server->>DB: UPDATE organization_nodes SET is_deleted = TRUE WHERE node_id = 200
    Note over DB: node_soft_delete_trigger 발동:<br/>1) path @> ARRAY[200] 인 모든 하위 자손 노드 is_deleted = TRUE<br/>2) 해당 노드들에 귀속된 work_items 도 연쇄 is_deleted = TRUE<br/>3) organization_node_histories 에 스냅샷 백업
    DB-->>Server: 삭제 성공
    Server-->>Client: 204 No Content

    Admin->>Client: 하위 노드만 단독 복구 시도 (nodeId: 205)
    Client->>Server: PATCH /api/org/nodes/restore {nodeId: 205}
    Server->>DB: SELECT * FROM restore_node(205)
    Note over DB: 부모 노드(200)의 is_deleted 가 TRUE 임을 감지<br/>-> 단독 복구 거부 (무결성 규칙)
    DB-->>Server: Exception: Parent node is deleted (Error P0306)
    Server-->>Client: 409 Conflict {"code": "P0306", "message": "상위 부모 노드가 삭제된 상태입니다."}
```

---

## 3. 역할 및 권한 관리 (Role & Authority)

### 3.1. 32비트 비트마스크 기반 커스텀 역할 생성 및 권한 검증

```mermaid
sequenceDiagram
    autonumber
    actor Admin as 최고관리자
    participant Client as 데스크톱 앱
    participant Server as Drogon Backend
    participant DB as PostgreSQL

    Admin->>Client: 역할 생성 ("코드리뷰어", 권한 체크박스 선택)
    Note over Client: 비트 조합 계산:<br/>NODE_VIEW(0) + GITHUB_VIEW(22) + WI_VIEW(4) = 0x00400011
    Client->>Server: POST /api/roles/definition {nodeId: 100, roleName: "코드리뷰어", authority: "0000...010000000000000000010001"}
    Server->>DB: INSERT INTO role_authorities (node_id, role, authority) VALUES (100, '코드리뷰어', B'...')
    DB-->>Server: authority_id: 15 생성
    Server-->>Client: 201 Created

    Admin->>Client: 특정 팀원(user_id: "U-102")에게 "코드리뷰어" 역할 부여
    Client->>Server: POST /api/roles {userId: "U-102", nodeId: 100, roleId: 15}
    Server->>DB: INSERT INTO role_assignments (user_id, node_id, role_id) VALUES ('U-102', 100, 15)
    DB-->>Server: 부여 완료
    Server-->>Client: 200 OK
    Server-)Client: 해당 유저에게 실시간 권한 갱신 WebSocket 이벤트 전송
```

---

### 3.2. 역할 회수 사전 검사 (Removal Preview) 및 회수 처리
유일한 관리자의 권한을 회수하여 워크스페이스가 무관리자 상태(고아 상태)가 되는 사고를 방지합니다.

```mermaid
sequenceDiagram
    autonumber
    actor Admin as 관리자
    participant Client as 데스크톱 앱
    participant Server as Drogon Backend
    participant DB as PostgreSQL

    Admin->>Client: 팀원 권한 회수 버튼 클릭
    Client->>Server: GET /api/roles/removal-preview?nodeId=100&userId=U-101
    Server->>DB: SELECT * FROM preview_role_removal(100, 'U-101')
    Note over DB: 해당 노드에 최고 관리자(Owner)가 유일한지 검사
    alt 마지막 남은 최고 관리자인 경우
        DB-->>Server: {can_remove: false, reason: "ONLY_TOP_ROLE_HOLDER"}
        Server-->>Client: 400 Bad Request (회수 불가 안내)
    else 안전한 경우
        DB-->>Server: {can_remove: true, affected_subnodes: 2}
        Server-->>Client: 200 OK (회수 확인 모달 노출)
        Admin->>Client: [최종 회수 확정]
        Client->>Server: DELETE /api/roles?nodeId=100&userId=U-101
        Server->>DB: DELETE FROM role_assignments WHERE node_id = 100 AND user_id = 'U-101'
        Server-->>Client: 204 No Content
    end
```

---

## 4. 업무 및 진행률 라이프사이클 (WorkItem & Tasks)

### 4.1. 업무 생성 및 가중치(Weight) 설정

```mermaid
sequenceDiagram
    autonumber
    actor User as 업무 작성자
    participant Client as 데스크톱 앱
    participant Server as Drogon Backend
    participant DB as PostgreSQL

    User->>Client: 업무 입력 (제목, 마감일, 부모업무 WI-10, 가중치 40%)
    Client->>Server: POST /api/workItems {ownerNodeId: 100, parentWorkItemId: "WI-10", title: "API 구현", weight: 40, priority: 3}
    Server->>Server: 권한 검증 (WI_PERSONAL_CHANGE 등)
    Server->>DB: SELECT * FROM create_work_item(...)
    Note over DB: 1) 노드 내 순번 display_id 발급<br/>2) 전역 work_item_id ("WI-10-1") 생성<br/>3) 형제 업무들과의 weight 합계 검증<br/>4) INSERT INTO work_items<br/>5) activity_logs 에 'inserted' 기록
    DB-->>Server: 생성된 WorkItem 레코드
    Server-->>Client: 201 Created {workItem: {...}}
    Server-)Client: WebSocket 브로드캐스트 (팀 타임라인 피드 실시간 갱신)
```

---

### 4.2. 하위 업무 완료 시 상위 프로젝트 진행률 자동 롤업 (Roll-up)
하위 태스크의 진행률이 바뀌면 PostgreSQL 트리거가 재귀적으로 상위 프로젝트의 진행률을 상향 재계산합니다.

```mermaid
sequenceDiagram
    autonumber
    actor Dev as 담당 개발자
    participant Client as 데스크톱 앱
    participant Server as Drogon Backend
    participant DB as PostgreSQL (Recursive Trigger)

    Dev->>Client: 업무 진행률 슬라이더를 100%로 변경 후 'done' 완료 처리
    Client->>Server: PATCH /api/workItems {workItemId: "WI-10-1", status: "done", progress: 100}
    Server->>DB: UPDATE work_items SET status = 'done', progress = 100 WHERE work_item_id = 'WI-10-1'
    
    Note over DB: work_item_progress_trigger 발동:<br/>1) 상위 부모(WI-10)의 모든 자식 업무 조회<br/>2) 각 자식의 (progress * weight / 100) 가중 평균 집계<br/>3) 상위 업무(WI-10)의 progress 컬럼 자동 UPDATE<br/>4) 상위에 또 부모가 있을 경우 최상위 루트까지 재귀 전파
    
    DB-->>Server: 최종 업데이트된 상/하위 업무 트리 정보 반환
    Server-->>Client: 200 OK {updatedWorkItems: [...]}
    Server-)Client: WebSocket 브로드캐스트 (대시보드 전체 진행률 게이지 실시간 변경)
```

---

### 4.3. 업무 댓글 작성 및 멘션 실시간 웹소켓 알림

```mermaid
sequenceDiagram
    autonumber
    actor Dev as 댓글 작성자
    participant ClientA as 작성자 클라이언트
    participant Server as Drogon Backend
    participant DB as PostgreSQL
    participant ClientB as 멘션 대상자 클라이언트

    Dev->>ClientA: 댓글 입력 ("@홍길동 이 부분 확인 부탁드립니다")
    ClientA->>Server: POST /api/workItems/comments {workItemId: "WI-10", content: "...", mentions: ["U-105"]}
    Server->>DB: 1) INSERT INTO work_item_comments (...) RETURNING comment_id<br/>2) INSERT INTO comment_mentions (comment_id, mentioned_user_id='U-105')
    DB-->>Server: 댓글 및 멘션 저장 완료
    Server-->>ClientA: 201 Created {commentId, createdAt}
    
    Server-)ClientB: WSS /api/notification/ws (type: "MENTION", actor: "김개발", workItem: "WI-10")
    Note over ClientB: 데스크톱 OS 네이티브 알림 팝업 및 우측 상단 벨 아이콘 배지 카운트 증가
```

---

## 5. 정기 루틴 및 반복 업무 (Recurring Rules)

### 5.1. 정기 루틴 규칙 등록 및 WorkItem 자동 발급

```mermaid
sequenceDiagram
    autonumber
    actor Leader as 팀 리더
    participant Client as 데스크톱 앱
    participant Server as Drogon Backend
    participant Cron as Backend Scheduler / Cron
    participant DB as PostgreSQL

    Leader->>Client: 정기 회의 루틴 등록 (매주 월요일 10:00, 업무 자동 생성 옵션 ON)
    Client->>Server: POST /api/recurringRules {ownerNodeId: 100, frequency: "WEEKLY", byDay: "MO", startTime: "10:00:00", autoCreateTask: true, checklists: ["회의록 작성", "이슈 공유"]}
    Server->>DB: 1) INSERT INTO recurring_rules (...)<br/>2) INSERT INTO recurring_rule_checklists (...)
    DB-->>Server: rule_id: 12 생성
    Server-->>Client: 201 Created

    Note over Cron: 매일 00:00 또는 스케줄 주기마다 자동 트리거
    Cron->>DB: SELECT * FROM evaluate_recurring_rules_for_today()
    Note over DB: 오늘(월요일) 조건에 부합하는 활성 규칙 감지<br/>autoCreateTask=TRUE 인 경우 work_items 자동 생성 INSERT
    DB-->>Cron: 생성된 오늘자 정기 WorkItem 목록
    Cron-)Client: WebSocket 브로드캐스트 (금일 팀 루틴 업무 목록 자동 노출)
```

---

## 6. 실시간 채팅 및 채널 (Chat & Messaging)

### 6.1. 워크스페이스 채널 / 1:1 DM 생성 및 메시징

```mermaid
sequenceDiagram
    autonumber
    actor UserA as 사용자 A
    participant ClientA as 클라이언트 A
    participant Server as Drogon Backend
    participant DB as PostgreSQL
    participant ClientB as 사용자 B

    UserA->>ClientA: 팀 내 새 토픽 채널 (#스프린트-1) 생성
    ClientA->>Server: POST /api/chat/channels {nodeId: 100, name: "스프린트-1", channelType: "WORKSPACE"}
    Server->>DB: INSERT INTO chat_channels (owner_node_id, name, channel_type)
    DB-->>Server: channel_id: 50 반환
    Server-->>ClientA: 201 Created

    UserA->>ClientA: 채널에 메시지 입력 후 전송
    ClientA->>Server: WSS /api/chat/ws (action: "SEND_MSG", channelId: 50, content: "회의 시작합니다.")
    Server->>DB: 1) INSERT INTO chat_messages (channel_id=50, sender_user_id='U-1', content=...)<br/>2) UPDATE chat_channels SET last_message_at = NOW()<br/>3) INSERT/UPDATE chat_channel_reads (작성자 읽음 갱신)
    DB-->>Server: message_id: 1001
    Server-)ClientA: WSS ACK (전송 완료 상태 반영)
    Server-)ClientB: WSS Broadcast (channelId: 50, message: {...})
    Note over ClientB: 채널 목록의 #스프린트-1 옆에 Unread 뱃지 표시
```

---

### 6.2. 1-Depth 스레드 답글 및 Unread 카운트 갱신

```mermaid
sequenceDiagram
    autonumber
    actor UserB as 사용자 B
    participant ClientB as 클라이언트 B
    participant Server as Drogon Backend
    participant DB as PostgreSQL

    UserB->>ClientB: 메시지(1001)에 답글 쓰기 클릭
    ClientB->>Server: POST /api/chat/messages {channelId: 50, parentMessageId: 1001, content: "지금 접속합니다."}
    Server->>DB: INSERT INTO chat_messages (channel_id=50, parent_message_id=1001, sender='U-2', content=...)
    DB-->>Server: message_id: 1002
    Server-->>ClientB: 201 Created

    UserB->>ClientB: 채널 화면 스크롤 하단 도달
    ClientB->>Server: POST /api/chat/channels/50/read {lastReadMessageId: 1002}
    Server->>DB: UPDATE chat_channel_reads SET last_read_message_id = 1002, last_read_at = NOW() WHERE channel_id=50 AND user_id='U-2'
    DB-->>Server: 갱신 성공
    Server-->>ClientB: 200 OK (Unread 카운트 0으로 초기화)
```

---

## 7. GitHub 연동 및 VSCode IDE 협업 (GitHub & IDE Integration)

### 7.1. GitHub 저장소 연동 및 로컬 클론/Worktree 준비

```mermaid
sequenceDiagram
    autonumber
    actor Admin as 워크스페이스 관리자
    participant Client as 데스크톱 앱
    participant Server as Drogon Backend (Git Coordinator)
    participant GitHub as GitHub Remote Server
    participant Storage as Shared Volume (/repository)
    participant DB as PostgreSQL

    Admin->>Client: 워크스페이스에 GitHub 저장소 추가 (URL 및 PAT 입력)
    Client->>Server: POST /api/github/repos {nodeId: 100, owner: "axisflow", repo: "frontend", pat: "ghp_..."}
    Server->>DB: PAT 대칭키 암호화 저장 (github_user_credentials)
    Server->>Server: Git 세마포어 획득 (GIT_MAX_NETWORK 슬롯 확보)
    Server->>GitHub: git ls-remote (URL 및 접근 권한 유효성 검증)
    GitHub-->>Server: 저장소 확인 완료
    
    Server->>Storage: git clone --bare https://... /repository/repos/{repo_id}.git
    Storage-->>Server: 로컬 베어 클론 완료
    Server->>DB: INSERT INTO github_repositories (node_id, owner_login, repo_name, default_branch, local_path)
    DB-->>Server: repo_id: 3 발급
    Server-->>Client: 201 Created {repoId: 3, defaultBranch: "main"}
```

---

### 7.2. 앱 ↔ VSCode Extension 원클릭 핸드오프 (Handoff Code)
앱에서 특정 업무 카드의 [VSCode로 열기] 버튼을 누르면 1회용 티켓을 발급받아 VSCode를 자동으로 기동하고 확장 프로그램 세션을 연결합니다.

```mermaid
sequenceDiagram
    autonumber
    actor Dev as 개발자
    participant App as 데스크톱 앱
    participant Server as Drogon Backend
    participant VSCode as VSCode Extension Host
    participant DB as PostgreSQL

    Dev->>App: 특정 업무(WI-101) [VSCode로 열기] 클릭
    App->>Server: POST /api/github/handoff {nodeId: 100, repoId: 3, workItemId: "WI-101"}
    Server->>Server: 1회용 Handoff Code(128자 난수) 생성 (TTL: 60초)
    Server->>DB: INSERT INTO github_handoff_codes (code, user_email, node_id, repo_id, expires_at)
    Server-->>App: {handoffCode: "hf_9a8b7c..."}
    
    App->>VSCode: OS Custom URI Scheme 호출: vscode://axisflow/open?code=hf_9a8b7c...
    Note over VSCode: VSCode가 자동으로 켜지며 Extension 진입점 실행
    
    VSCode->>Server: POST /api/github/sessions {code: "hf_9a8b7c..."}
    Server->>DB: UPDATE github_handoff_codes SET consumed_at = NOW() WHERE code = ? AND consumed_at IS NULL
    Server->>DB: INSERT INTO github_extension_tokens (user_email, refresh_token, expires_at)
    Server->>Server: Worktree 생성 또는 기존 경로 조회 (/repository/worktrees/{branch})
    Server-->>VSCode: 200 OK {extensionAccessToken, repoPath, branchName: "feat/WI-101"}
    VSCode-->>Dev: 작업 폴더 자동 오픈 및 에디터 준비 완료
```

---

### 7.3. 실시간 동시 편집 (CRDT Y.Doc) 및 Worktree 원자적 파일 플러시
웹 브라우저/앱 내 에디터에서 여러 사용자가 같은 파일을 열고 실시간 협업할 때 발생하는 충돌 방지 및 디스크 동기화 흐름입니다.

```mermaid
sequenceDiagram
    autonumber
    actor DevA as 개발자 A
    actor DevB as 개발자 B
    participant Collab as Collab Sidecar (Node.js Yjs)
    participant Server as Drogon Backend
    participant Storage as Shared Volume (Worktree)

    DevA->>Server: POST /api/collab/tickets {repoId: 3, branch: "feat/WI-101", filePath: "src/main.ts"}
    Server-->>DevA: 1회용 Collab Ticket 발급
    DevA->>Collab: WSS /collab?ticket=... 연결
    Collab->>Server: POST /internal/collab/tickets/consume
    Server-->>Collab: 티켓 검증 완료 (유저 식별자 및 파일 경로 확인)
    Collab-->>DevA: Yjs 초기 바이너리 State Vector 동기화

    DevB->>Collab: WSS /collab?ticket=... 연결 (동일 파일 참여)
    Collab-->>DevB: 현재 파일 편집 상태 스트리밍

    DevA->>Collab: 타이핑 (Yjs CRDT 델타 패킷 전송)
    Collab-)DevB: 실시간 커서 위치 및 텍스트 반영 (동시 충돌 자동 해결)
    
    Note over Collab: Debounce 2초 대기 (입력 정지 감지)
    Collab->>Storage: 원자적 파일 쓰기 (Worktree의 src/main.ts 디스크 플러시)
    Storage-->>Collab: 플러시 완료
    Collab->>Server: POST /internal/collab/worktree-changed (파일 변경 통지)
    Server-)DevA: WSS /api/github/ws (Git Dirty 상태 이벤트 전달)
    Server-)DevB: WSS /api/github/ws (Git Dirty 상태 이벤트 전달)
```

---

### 7.4. 웹 브라우저/앱 내 Git 스테이징, 커밋 및 원격 Push

```mermaid
sequenceDiagram
    autonumber
    actor Dev as 개발자
    participant Client as 데스크톱 앱
    participant Server as Drogon Backend (Git Coordinator)
    participant Storage as Shared Volume (Worktree)
    participant GitHub as GitHub Remote
    participant DB as PostgreSQL

    Dev->>Client: [변경사항 스테이징] 클릭
    Client->>Server: POST /api/github/repos/stage {repoId: 3, branch: "feat/WI-101", files: ["src/main.ts"]}
    Server->>Storage: git -C {worktreePath} add src/main.ts
    Storage-->>Server: 스테이징 완료
    Server-->>Client: 200 OK (Staged 상태 반환)

    Dev->>Client: 커밋 메시지 입력 ("feat: WI-101 로그인 UI 구현") 후 [커밋] 클릭
    Client->>Server: POST /api/github/repos/commits {repoId: 3, branch: "feat/WI-101", message: "feat: WI-101..."}
    Server->>Storage: git -C {worktreePath} commit -m "..."
    Storage-->>Server: 커밋 SHA 발급 (예: "a1b2c3d")
    Server->>DB: INSERT INTO github_commit_logs (repo_id, sha, message, matched_work_item_id='WI-101', pushed=FALSE)
    Server-->>Client: 201 Created {sha: "a1b2c3d"}

    Dev->>Client: [원격 저장소로 Push] 클릭
    Client->>Server: POST /api/github/repos/push {repoId: 3, branch: "feat/WI-101"}
    Server->>DB: 사용자 PAT 복호화
    Server->>Server: Git 세마포어 획득 (GIT_MAX_NETWORK 슬롯)
    Server->>GitHub: git push origin feat/WI-101 (인증 헤더 포함)
    GitHub-->>Server: Push 성공 (200 OK)
    Server->>DB: UPDATE github_commit_logs SET pushed = TRUE WHERE sha = 'a1b2c3d'
    Server-->>Client: 200 OK (원격 브랜치 푸시 성공)
    Server-)Client: WebSocket 브로드캐스트 (저장소 동기화 상태 갱신)
```
