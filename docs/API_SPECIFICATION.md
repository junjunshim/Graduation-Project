# 📄 API 명세서

## 공통 응답/요청 방식 정의
- **API 요청 형식** : `application/json` (파일 업로드는 `multipart/form-data`)
- **최대 요청 본문 크기** : `100MB` (대용량 첨부파일 업로드 지원)
- **HTTP 응답 압축 (Response Compression)** :
  - 서버는 **Brotli(`br`)** 및 **Gzip(`gzip`)** 압축 알고리즘을 기본 지원합니다.
  - **클라이언트 앱(React/Electron/Axios)**: Chromium/브라우저 네트워크 계층에서 `Accept-Encoding: gzip, deflate, br`을 자동으로 전송하고 응답을 자동 압축 해제하므로 별도의 헤더 설정이나 해제 코드가 필요하지 않습니다.
  - **터미널(curl 테스트)**: `--compressed` 옵션을 사용하면 자동으로 압축 해제된 JSON을 확인할 수 있습니다.
- **성공/실패 여부** : HTTP 상태 코드를 통해서 제공

| HTTP Status | Code | Message | Description |
| :--- | :--- | :--- | :--- |
| OK | 200 | 성공 | 요청이 성공적으로 처리됨 |
| Created | 201 | 생성됨 | 새로운 리소스가 성공적으로 생성됨 |
| No Content | 204 | 내용 없음 | 삭제 요청 성공 (반환할 본문 없음) |
| Not Modified | 304 | 변경 없음 | 조건부 요청(`If-Modified-Since`) 결과 파일이 변경되지 않음 |
| Bad Request | 400 | 부적절한 요청 | 필수 파라미터 누락 또는 데이터 형식 오류 |
| Unauthorized | 401 | 권한 없음 | 인증이 필요하거나 유효하지 않은 토큰 |
| Forbidden | 403 | 접근 거부 | 해당 노드/업무에 대한 수정/삭제/조회 권한 없음 |
| Not Found | 404 | 찾을 수 없음 | 존재하지 않는 노드/업무/파일/일정 ID 참조 |
| Conflict | 409 | 충돌 | 중복된 데이터 또는 비즈니스 로직 충돌 |
| Payload Too Large | 413 | 요청 본문 초과 | 업로드 파일 크기가 100MB를 초과함 |
| Internal Server Error | 500 | 서버 오류 | DB 연결 실패 또는 서버 내부 로직 오류 |

- **공통 에러 응답 객체**
```json
{
  "status": "error",
  "code": "404",
  "message": "부모 노드가 존재하지 않습니다.",
  "detail": "parent_node_id: 999"
}
```

---

## API 목록 (도메인/성격별 분류)

### 1. 사용자 및 인증 (Auth & User)

| 구분 | Http Method | API Path | 개발현황 | MD링크 |
| :--- | :--- | :--- | :--- | :--- |
| 회원가입 | Post | /api/users | 완료 | [link](api/Post/sign_in.md) |
| 로그인 / 토큰 발급 | Post | /api/users/login | 완료 | [link](api/Post/login.md) |
| 토큰 재발급 | Post | /api/users/refresh | 완료 | [link](api/Post/refresh.md) |
| User 데이터 조회 | Get | /api/users | 완료 | [link](api/Get/user.md) |
| User 데이터 수정 | Patch | /api/users | 완료 | [link](api/Patch/user.md) |
| User 데이터 삭제 | Delete | /api/users | 완료 | [link](api/Delete/user.md) |
| 알림 읽음 처리 | Patch | /api/users/notifications/read | 완료 | [link](api/Patch/notification_read.md) |

---

### 2. 조직도 및 노드 관리 (Organization & Nodes)

| 구분 | Http Method | API Path | 개발현황 | MD링크 |
| :--- | :--- | :--- | :--- | :--- |
| Org 최상위 노드 생성 | Post | /api/org/topNodes | 완료 | [link](api/Post/top_nodes.md) |
| Org 하위 노드 생성 | Post | /api/org/subNodes | 완료 | [link](api/Post/sub_nodes.md) |
| Org 노드 상세 조회 | Get | /api/org/nodes | 완료 | [link](api/Get/node_detail.md) |
| Org 노드 수정 | Patch | /api/org/nodes | 완료 | [link](api/Patch/node.md) |
| Org 노드 이전 사전 검사 | Post | /api/org/nodes/move-preview | 완료 | [link](api/Patch/node_move.md) |
| Org 노드 이전 | Patch | /api/org/nodes/move | 완료 | [link](api/Patch/node_move.md) |
| Org 노드 삭제 | Delete | /api/org/nodes | 완료 | [link](api/Delete/node.md) |
| Org 노드 복구 | Patch | /api/org/nodes/restore | 완료 | [link](api/Patch/node_restore.md) |
| 활동 기록 조회 | Get | /api/org/activities | 완료 | [link](api/Get/activity.md) |

---

### 3. 역할 및 권한 관리 (Role & Authority)

| 구분 | Http Method | API Path | 개발현황 | MD링크 |
| :--- | :--- | :--- | :--- | :--- |
| Role 부여 | Post | /api/roles | 완료 | [link](api/Post/role.md) |
| Role 변경 | Patch | /api/roles | 완료 | [link](api/Patch/role.md) |
| Role 회수 사전 확인 | Get | /api/roles/removal-preview | 완료 | [link](api/Get/role_removal_preview.md) |
| Role 회수 | Delete | /api/roles | 완료 | [link](api/Delete/role.md) |
| Role 정의 생성 | Post | /api/roles/definition | 완료 | [link](api/Post/role_definition.md) |
| Role 권한 수정 | Patch | /api/roles/definition | 완료 | [link](api/Patch/role_definition.md) |
| Role 이름 변경 | Patch | /api/roles/rename | 완료 | [link](api/Patch/role_rename.md) |
| Role 삭제 사전 확인 | Get | /api/roles/definition/deletion-preview | 완료 | [link](api/Get/role_definition_deletion_preview.md) |
| Role 삭제 | Delete | /api/roles/definition | 완료 | [link](api/Delete/role_definition.md) |

---

### 4. 업무 및 파일 관리 (Work Item & Attachments)

| 구분 | Http Method | API Path | 개발현황 | MD링크 |
| :--- | :--- | :--- | :--- | :--- |
| WorkItem 생성 | Post | /api/workItems | 완료 | [link](api/Post/work_item.md) |
| WorkItem 상세 조회 | Get | /api/workItems | 완료 | [link](api/Get/work_item.md) |
| WorkItem 수정 | Patch | /api/workItems | 완료 | [link](api/Patch/work_item.md) |
| WorkItem 삭제 | Delete | /api/workItems | 완료 | [link](api/Delete/work_item.md) |
| WorkItem 복구 | Patch | /api/workItems/restore | 완료 | [link](api/Patch/work_item_restore.md) |
| WorkItem 댓글 작성 | Post | /api/workItems/comments | 완료 | [link](api/Post/comment.md) |
| WorkItem 파일 업로드 | Post | /api/workItems/files/upload | 완료 | [link](api/Post/file_upload.md) |
| WorkItem 파일 목록 조회 | Get | /api/workItems/files | 완료 | [link](api/Get/files.md) |
| WorkItem 파일 다운로드 | Get | /api/workItems/files/download | 완료 | [link](api/Get/file_download.md) |
| WorkItem 파일 삭제 | Delete | /api/workItems/files | 완료 | [link](api/Delete/file.md) |
| WorkItem 파일 복구 | Patch | /api/workItems/files/restore | 완료 | [link](api/Patch/file_restore.md) |

---

### 5. 정기 일정 관리 (Recurring Rules)

| 구분 | Http Method | API Path | 개발현황 | MD링크 |
| :--- | :--- | :--- | :--- | :--- |
| 정기 일정 목록 조회 | Get | /api/recurringRules | 완료 | [link](api/Get/recurring_rules.md) |
| 정기 일정 상세 조회 | Get | /api/recurringRules/{ruleId} | 완료 | [link](api/Get/recurring_rule_detail.md) |
| 정기 일정 생성 | Post | /api/recurringRules | 완료 | [link](api/Post/recurring_rule.md) |
| 정기 일정 수정 | Put | /api/recurringRules/{ruleId} | 완료 | [link](api/Put/recurring_rule.md) |
| 정기 일정 삭제 | Delete | /api/recurringRules/{ruleId} | 완료 | [link](api/Delete/recurring_rule.md) |
| 정기 일정 복구 | Patch | /api/recurringRules/{ruleId}/restore | 완료 | [link](api/Patch/recurring_rule_restore.md) |
| 정기 일정 파일 업로드 | Post | /api/recurringRules/{ruleId}/files | 완료 | [link](api/Post/recurring_rule_file_upload.md) |
| 정기 일정 파일 다운로드 | Get | /api/recurringRules/files/{fileId}/download | 완료 | [link](api/Get/recurring_rule_file_download.md) |
| 정기 일정 파일 삭제 | Delete | /api/recurringRules/files/{fileId} | 완료 | [link](api/Delete/recurring_rule_file.md) |
| 정기 일정 파일 복구 | Patch | /api/recurringRules/files/{fileId}/restore | 완료 | [link](api/Patch/recurring_rule_file_restore.md) |

---

### 6. 컨텍스트 및 시스템 알림 (Context & Notification)

| 구분 | Http Method | API Path | 개발현황 | MD링크 |
| :--- | :--- | :--- | :--- | :--- |
| 사용자 전체 정보 조회 | Get | /api/context/init | 완료 | [link](api/Get/context_init.md) |
| 워크스페이스 스코프 조회 | Get | /api/context/scope | 완료 | [link](api/Get/context_scope.md) |
| 대시보드 데이터 조회 | Get | /api/context/dashboard | 완료 | [link](api/Get/dashboard.md) |
| 실시간 알림 WebSocket | WebSocket (Get) | /api/notification/ws | 완료 | [link](api/Get/websocket_notification.md) |

---

### 7. GitHub 저장소 연동 및 작업 트리 (GitHub & Workspace)

| 구분 | Http Method | API Path | 개발현황 | MD링크 |
| :--- | :--- | :--- | :--- | :--- |
| GitHub 저장소 연결 | Post | /api/github/repos | 완료 | [link](api/Post/github_repo.md) |
| GitHub 저장소 목록 조회 | Get | /api/github/repos | 완료 | [link](api/Get/github_repos.md) |
| GitHub 저장소 연결 해제 | Delete | /api/github/repos | 완료 | [link](api/Delete/github_repo.md) |
| GitHub 브랜치 목록 조회 | Get | /api/github/repos/branches | 완료 | [link](api/Get/github_branches.md) |
| GitHub 브랜치별 접속자 조회 | Get | /api/github/repos/presence | 완료 | [link](api/Get/github_presence.md) |
| GitHub 브랜치 생성 | Post | /api/github/repos/branches | 완료 | [link](api/Post/github_branch.md) |
| GitHub 브랜치 삭제 | Delete | /api/github/repos/branches | 완료 | [link](api/Delete/github_branch.md) |
| GitHub 저장소 파일 트리 조회 | Get | /api/github/repos/tree | 완료 | [link](api/Get/github_tree.md) |
| GitHub 저장소 파일 내용 조회 | Get | /api/github/repos/file | 완료 | [link](api/Get/github_file.md) |
| GitHub 커밋 내역 조회 | Get | /api/github/repos/commits | 완료 | [link](api/Get/github_commits.md) |
| GitHub 변경 파일 목록 조회 (Diff) | Get | /api/github/repos/diff | 완료 | [link](api/Get/github_diff.md) |
| GitHub 파일 생성 | Post | /api/github/repos/files | 완료 | [link](api/Post/github_file.md) |
| GitHub 파일 이름 변경/이동 | Patch | /api/github/repos/files | 완료 | [link](api/Patch/github_file.md) |
| GitHub 파일 삭제 | Delete | /api/github/repos/files | 완료 | [link](api/Delete/github_file.md) |
| GitHub 디렉터리 생성 | Post | /api/github/repos/dirs | 완료 | [link](api/Post/github_dir.md) |
| GitHub 작업 트리 상태 조회 | Get | /api/github/repos/status | 완료 | [link](api/Get/github_status.md) |
| GitHub 파일 스테이징 | Post | /api/github/repos/stage | 완료 | [link](api/Post/github_stage.md) |
| GitHub 파일 언스테이징 | Delete | /api/github/repos/stage | 완료 | [link](api/Delete/github_stage.md) |
| GitHub 변경사항 되돌리기 | Post | /api/github/repos/discard | 완료 | [link](api/Post/github_discard.md) |
| GitHub 저장소 Fetch | Post | /api/github/repos/fetch | 완료 | [link](api/Post/github_fetch.md) |
| GitHub 동기화 상태 조회 | Get | /api/github/repos/sync | 완료 | [link](api/Get/github_sync.md) |
| GitHub 커밋 생성 | Post | /api/github/repos/commits | 완료 | [link](api/Post/github_commit.md) |
| GitHub 원격 Push | Post | /api/github/repos/push | 완료 | [link](api/Post/github_push.md) |
| GitHub 실시간 제어 WebSocket | WebSocket (Get) | /api/github/ws | 완료 | [link](api/Get/github_websocket.md) |

---

### 8. GitHub 자격증명 및 VSCode 확장 세션 (Credentials & VSCode Extension)

| 구분 | Http Method | API Path | 개발현황 | MD링크 |
| :--- | :--- | :--- | :--- | :--- |
| GitHub 자격증명 상태 조회 | Get | /api/github/credentials | 완료 | [link](api/Get/github_credentials.md) |
| GitHub 자격증명 등록 | Post | /api/github/credentials | 완료 | [link](api/Post/github_credentials.md) |
| GitHub 자격증명 연결 해제 | Delete | /api/github/credentials | 완료 | [link](api/Delete/github_credentials.md) |
| VSCode 확장 핸드오프 코드 생성 | Post | /api/github/handoff | 완료 | [link](api/Post/github_handoff.md) |
| VSCode 확장 세션 토큰 교환 | Post | /api/github/sessions | 완료 | [link](api/Post/github_sessions.md) |
| VSCode 확장 세션 토큰 갱신 | Post | /api/github/sessions/refresh | 완료 | [link](api/Post/github_sessions_refresh.md) |

---

### 9. 실시간 문서 협업 서버 연동 (Collab Sidecar & Internal)

| 구분 | Http Method | API Path | 개발현황 | MD링크 |
| :--- | :--- | :--- | :--- | :--- |
| 실시간 협업 세션 티켓 발급 | Post | /api/collab/tickets | 완료 | [link](api/Post/collab_ticket.md) |
| 협업 티켓 소비/검증 (내부) | Post | /internal/collab/tickets/consume | 완료 | [link](api/Post/collab_consume_ticket.md) |
| 협업 경로 해석 (내부) | Post | /internal/collab/resolve | 완료 | [link](api/Post/collab_resolve.md) |
| 협업 worktree 변경 통지 (내부) | Post | /internal/collab/worktree-changed | 완료 | [link](api/Post/collab_worktree_changed.md) |
| 협업 세션 권한 재확인 (내부) | Post | /internal/collab/permissions/recheck | 완료 | [link](api/Post/collab_permissions_recheck.md) |