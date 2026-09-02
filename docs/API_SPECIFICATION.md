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
| Bad Request | 400 | 부적절한 요청 | 필수 파라미터 누락 또는 데이터 형식 오류 |
| Unauthorized | 401 | 권한 없음 | 인증이 필요하거나 유효하지 않은 토큰 |
| Forbidden | 403 | 접근 거부 | 해당 노드/업무에 대한 수정/삭제/조회 권한 없음 |
| Not Found | 404 | 찾을 수 없음 | 존재하지 않는 노드/업무/파일 ID 참조 |
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

## API

| 구분 | Http Method | API Path | 개발현황 | MD링크 |
| :--- | :--- | :--- | :--- | :--- |
| 회원가입 | Post | /api/users | 완료 | [link](api/Post/sign_in.md) |
| user 데이터 조회 | Get | /api/users | 완료 | [link](api/Get/user.md) |
| user 데이터 수정 | Patch | /api/users | 완료 | [link](api/Patch/user.md) |
| user 데이터 삭제 | Delete | /api/users | 완료 | [link](api/Delete/user.md) |
| 알림 읽음 처리 | Patch | /api/users/notifications/read | 완료 | [link](api/Patch/notification_read.md) |
| 로그인 / 토큰 발급 | Post | /api/users/login | 완료 | [link](api/Post/login.md) |
| 토큰 재발급 | Post | /api/users/refresh | 완료 | [link](api/Post/refresh.md) |
| Org 최상위 노드 | Post | /api/org/topNodes | 완료 | [link](api/Post/top_nodes.md) |
| Org 하위 노드 | Post | /api/org/subNodes | 완료 | [link](api/Post/sub_nodes.md) |
| Org 노드 수정 | Patch | /api/org/nodes | 완료 | [link](api/Patch/node.md) |
| Org 노드 삭제 | Delete | /api/org/nodes | 완료 | [link](api/Delete/node.md) |
| Org 노드 복구 | Patch | /api/org/nodes/restore | 완료 | [link](api/Patch/node_restore.md) |
| Org 노드 상세 조회 | Get | /api/org/nodes | 완료 | [link](api/Get/node_detail.md) |
| 활동 기록 조회 | Get | /api/org/activities | 완료 | [link](api/Get/activity.md) |
| Role 부여 | Post | /api/roles | 완료 | [link](api/Post/role.md) |
| Role 수정 | Patch | /api/roles | 완료 | [link](api/Patch/role.md) |
| Role 생성 | Post | /api/roles/definition | 완료 | [link](api/Post/role_definition.md) |
| Role 권한 수정 | Patch | /api/roles/definition | 완료 | [link](api/Patch/role_definition.md) |
| work_item 생성 | Post | /api/workItems | 완료 | [link](api/Post/work_item.md) |
| work_item 수정 | Patch | /api/workItems | 완료 | [link](api/Patch/work_item.md) |
| work_item 삭제 | Delete | /api/workItems | 완료 | [link](api/Delete/work_item.md) |
| work_item 복구 | Patch | /api/workItems/restore | 완료 | [link](api/Patch/work_item_restore.md) |
| work_item 상세 조회 | Get | /api/workItems | 완료 | [link](api/Get/work_item.md) |
| work_item 댓글 작성 | Post | /api/workItems/comments | 완료 | [link](api/Post/comment.md) |
| work_item 파일 업로드 | Post | /api/workItems/files/upload | 완료 | [link](api/Post/file_upload.md) |
| work_item 파일 목록 조회 | Get | /api/workItems/files | 완료 | [link](api/Get/files.md) |
| work_item 파일 다운로드 | Get | /api/workItems/files/download | 완료 | [link](api/Get/file_download.md) |
| work_item 파일 삭제 | Delete | /api/workItems/files | 완료 | [link](api/Delete/file.md) |
| work_item 파일 복구 | Patch | /api/workItems/files/restore | 완료 | [link](api/Patch/file_restore.md) |
| 사용자 전체 정보 조회 | Get | /api/context/init | 완료 | [link](api/Get/context_init.md) |
| 사용자 데이터 동기화 | Get | /api/context/sync | 완료 | [link](api/Get/sync_context.md) |