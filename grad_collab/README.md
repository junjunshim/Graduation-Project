# grad_collab — Axis Share 협업 문서 서버

VSCode 확장과 backend(C++) 사이에서 **텍스트의 진실**을 갖는 Node.js 프로세스다.
설계는 `TASK_11` §9(상세 설계) / §13(배포) / §14(모듈 구조)를 따른다.

- 하는 일: `(repo, branch, file)` 별 권위 `Y.Doc`, Yjs 병합, 커서·데코 중계, worktree 파일 flush
- 하지 않는 일: git 명령, DB 접근, 사용자 인증(JWT 해석) — 전부 backend 담당
- 경계는 **flush 된 worktree 파일** 하나다. collab 이 파일을 내려쓰고 backend 가 그 파일을 `git add`/`commit` 한다.

## 환경변수

| 이름 | 기본값 | 설명 |
|:---|:---|:---|
| `PORT` | `3000` | 리스닝 포트(nginx `/collab/` 가 이 포트로 프록시) |
| `API_BASE` | `http://backend:8080` | backend 내부 API 주소 |
| `INTERNAL_TOKEN` | (없음) | backend ↔ collab 내부 인증 토큰. **비어 있으면 모든 티켓을 거부한다(fail-closed)** |
| `REPO_ROOT` | `/app/repository` | 저장소 볼륨 마운트 지점(backend 와 같은 물리 볼륨) |
| `FLUSH_DEBOUNCE_MS` | `2000` | 마지막 편집 후 파일에 내려쓰기까지의 디바운스(§9.4 ①) |
| `DOC_IDLE_UNLOAD_MS` | `30000` | 마지막 편집자가 나간 뒤 doc 을 내리는 유예(§9.3) |
| `AUTOSAVE_INTERVAL_MS` | `30000` | 열린 doc 을 주기적으로 내려쓰는 간격(§9.4 ④) |
| `MAX_DOC_BYTES` | `524288` | 동시 편집을 허용하는 파일 크기 상한(512KB, §6-10) |
| `MAX_OPEN_DOCS_PER_BRANCH` | `200` | 한 브랜치(방)에서 **동시에 열어 둘 수 있는 파일 수** 상한(§9.10). 넘으면 `open` 이 `P0909` 로 거절한다 |
| `MAX_OPEN_DOC_CHARS_PER_BRANCH` | `10000000` | 한 브랜치가 들고 있을 수 있는 **열린 doc 총량**(문자 수) 상한(§9.10). 넘으면 `open` 이 `P0910` 로 거절한다 — 메모리는 개수가 아니라 크기에 비례해서, 파일 수 상한만으로는 최악값(200 × 512KB)을 막지 못한다 |
| `MAX_SOCKET_BUFFER_BYTES` | `16777216` | 소켓 하나의 **송신 버퍼** 상한(바이트, §9.10). 느린 수신자에게 팬아웃해 버퍼가 이 값을 넘으면 그 소켓만 끊는다(확장은 재접속 후 재동기화, §12.10) |
| `PERMISSION_RECHECK_MS` | `300000` | 세션 권한 재확인 주기(ms, §12.9). 지금 붙어 있는 세션의 `can_view`/`can_write` 를 backend 에 다시 물어보는 주기다 — 권한 변경 통보가 유실된 경우의 안전망. `0` 이면 끈다 |

## 모듈

| 모듈 | 책임 |
|:---|:---|
| `server.ts` | HTTP+WS 부트스트랩, 메시지 라우팅, graceful shutdown |
| `config.ts` | env 파싱 |
| `auth.ts` | 1회용 티켓 → 세션(`user_email`, `user_name`, `repo_id`, `node_id`, `can_write`) |
| `repoResolver.ts` | backend 내부 API 로 브랜치 작업 디렉터리 해석(60초 캐시) |
| `rooms.ts` | `repo:{id}:branch:{name}` 방, 참가자, 방 단위 브로드캐스트 |
| `docRegistry.ts` | 경로 → `Y.Doc` 1개. 로드/refcount/flush/unload, 데코레이션 보관 |
| `store.ts` | worktree 파일 읽기/flush(원자적 교체·EOL 보존), `.ydoc` 영속화 |
| `presence.ts` | 파일별 커서 집계(휘발성 — 저장하지 않는다) |
| `permissionCheck.ts` | 세션 권한 재확인(주기) — backend `/internal/collab/permissions/recheck` 호출. 실패는 빈 결과(세션을 건드리지 않는다) |
| `protocol.ts` | 메시지 타입·필수 필드·크기 상한 검증 |
| `paths.ts` | 경로 안전 검사(상위 탈출·절대 경로 차단) |
| `logger.ts` | 구조화 로그(`{repo,branch,path,user}`) |

## 엔드포인트

| Method | 경로 | 인증 | 설명 |
|:---|:---|:---|:---|
| GET | `/healthz` | 없음 | 상태(방 수, 열린 doc 수, 마지막 flush 시각). compose healthcheck 가 쓴다 |
| WS | `/collab/?ticket=<t>` | 1회용 티켓 | 문서 소켓 |
| POST | `/internal/collab/tickets/consume` | — | (backend 가 제공) collab 이 부르는 티켓 검증 API |
| POST | `/internal/collab/resolve` | — | (backend 가 제공) collab 이 부르는 작업 디렉터리 해석 API |
| POST | `/internal/collab/permissions/recheck` | — | (backend 가 제공) collab 이 부르는 **세션 권한 재확인** API. `sessions: [{repo_id, user_email}]` 를 넘기면 세션마다 `can_view`/`can_write` 를 다시 계산해 돌려준다(§12.9). 없는 세션은 `can_view=false` |
| POST | `/internal/collab/permission` | `X-Internal-Token` | **collab 이 제공** — backend 가 부르는 권한 변경 통보. `can_write` 가 바뀐 세션은 `perm` 을 받고, `can_view=false` 인 세션은 **끝난다**(`repo_closed { reason: authority_lost }` → 소켓 닫기, §12.9) |
| POST | `/internal/collab/repo/close` | `X-Internal-Token` | **collab 이 제공** — backend 가 부르는 저장소 닫기 통보(노드 삭제). 그 저장소의 모든 방을 **내려쓴 뒤**(편집 보존) 접속자에게 `repo_closed` 를 보내고 소켓을 닫는다(§12.9) |

- 티켓이 없으면 `401`, 검증 실패 `401`/`503`, backend 가 죽어 있으면 `503`(P0903).
- collab 은 외부에 직접 노출하지 않는다. nginx `location ^~ /collab/` 만 연다.

## 문서 소켓 프로토콜

프레임은 **JSON 텍스트 + base64** 다(§9.5, 1차). **클라이언트 → collab** 프레임의 상한은 4MB 다(초과하면 `P0905` 로 거절). **collab → 클라이언트**는 그 상한을 넘을 수 있다 — 읽기 전용 열람(`file`)이 그렇다(상한 `MAX_READONLY_BYTES`, 기본 4MB → base64 약 5.3MB, §12.6).

클라이언트 → collab:

| type | payload | 설명 |
|:---|:---|:---|
| `join` | `{ repo_id, branch }` | 브랜치 방 입장(방이 없으면 만든다) |
| `open` | `{ path }` | 파일 doc 참여(없으면 worktree 파일에서 생성). 방의 열린 doc 수가 `MAX_OPEN_DOCS_PER_BRANCH` 를 넘으면 `P0909` 로 거절한다(§9.10) |
| `close` | `{ path }` | 파일 doc 이탈 |
| `read` | `{ path }` | 편집할 수 없는 파일(바이너리·대용량·비 UTF-8)의 내용 1회 조회 — 읽기 전용 열람(§12.6). doc 을 만들지 않는다 |
| `update` | `{ path, update }` | Yjs 델타(base64) |
| `cursor` | `{ path, startRel, endRel, activeRel }` | 커서·선택 영역(저장하지 않음) |
| `deco_add` | `{ path, id, ... }` | 리뷰 데코레이션(추가 필드는 그대로 보관) |
| `deco_del` | `{ path, id }` | 리뷰 데코레이션 삭제 |
| `flush` | `{ path? }` | 파일 강제 내려쓰기(경로 생략 시 방의 모든 doc) |
| `switch_branch` | `{ repo_id, from, to }` | 내려쓰고 → 방을 나가고 → 새 브랜치 방 입장 |

collab → 클라이언트:

| type | payload | 설명 |
|:---|:---|:---|
| `joined` | `{ branch, default_branch, is_default, can_write }` | 방 입장 완료 |
| `opened` | `{ path, state, eol, can_write, mismatch, watchers }` | doc 초기 상태 |
| `file` | `{ path, encoding, size, content }` | `read` 응답. `encoding` 은 `utf-8`(본문) · `base64`(바이너리) · `none`(상한 초과라 크기만) |
| `update` | `{ path, update, from }` | 같은 파일 편집자에게 팬아웃 |
| `cursor` | `{ path, userEmail, userName, startRel, endRel, activeRel }` | 팬아웃 |
| `deco` | `{ path, id, userEmail, userName, ... }` | 팬아웃(작성자는 세션 값으로 확정) |
| `deco_del` | `{ path, id, userEmail }` | 팬아웃 |
| `flushed` | `{ path }` | flush 완료(커밋 전 대기 해제) |
| `perm` | `{ can_write }` | 쓰기 권한 변경 통보(§12.9) — false 면 확장이 즉시 읽기 전용으로 전환한다 |
| `repo_closed` | `{ repo_id, reason, message }` | 저장소와의 인연이 끝났다(§12.9). `node_deleted`(노드 삭제, 저장소 전체) 또는 `authority_lost`(보기 권한 상실, 그 사람만). 확장은 편집 세션을 정리하고, 제어 소켓도 backend 가 따로 끊는다 |
| `peer_join` / `peer_leave` | `{ path, userEmail, userName? }` | **파일 doc 참여자** 변동 — 그 파일을 연 사람에게만 간다 |
| `open_files` | `{ branch, files: [{ path, watchers }] }` | 입장 직후 1회 — 방에 지금 열려 있는 파일과 사람(§15.5) |
| `file_watchers` | `{ path, watchers: [{ email, name }] }` | 그 파일의 참여자 **집합**이 바뀌었다. 방 전체에 가며, 빈 배열이면 목록에서 지운다 |
| `doc_reset` | `{ path, deleted, reason? }` | 되돌리기·트리 변경·브랜치 삭제로 그 doc 을 버렸다 — 클라이언트는 탭을 닫는다(§12.11.1) |
| `err` | `{ code, message, path?, reason? }` | 오류(P09xx). `P0905` 에는 어느 파일이 왜 편집 불가인지(`path`·`reason`)를 함께 싣는다 — 확장이 읽기 전용 열람(`read`)으로 잇는다(§12.6) |

- **`opened` 를 받은 뒤에만 `update` 를 보낸다**(§9.6). 소켓별로 프레임을 순서대로 처리한다.
- `opened.state` 에는 텍스트뿐 아니라 **데코레이션도 함께 들어 있다**(같은 `Y.Doc` 상태).
- `opened.mismatch=true` 는 "영속화된 doc 과 worktree 파일이 달라 doc 을 우선했다"는 표시다(§9.3). 자동 병합하지 않는다.

### 오류 코드 (P09xx)

| 코드 | 의미 |
|:---|:---|
| `P0901` | 티켓이 만료되었거나 이미 사용됨 |
| `P0902` | 이 저장소에 편집 권한이 없음(read-only 티켓) |
| `P0903` | 협업 서버를 사용할 수 없음(내부 토큰 미설정·backend 연결 실패) |
| `P0905` | 편집할 수 없는 파일(없음·바이너리·512KB 초과·비 UTF-8). `path`·`reason` 동봉 — 확장은 그 값으로 읽기 전용 열람(`read`/`file`)으로 넘어간다 |
| `P0906` | flush 실패 / 파일을 열지 못함 |
| `P0801` | 등록되지 않은 저장소·브랜치 |
| `P0807` | 저장소 경로 정보가 올바르지 않거나 작업 디렉터리가 준비되지 않음 |
| `P0815` | 연결된 워크스페이스가 삭제됨 — 세션·방을 열 수 없음(§12.9) |
| `P0909` | 한 브랜치에서 동시에 열려 있는 doc 수가 상한(`MAX_OPEN_DOCS_PER_BRANCH`)을 넘음 — 다른 파일을 닫아야 한다(§9.10) |
| `P0910` | 한 브랜치에 열린 doc **총량**이 상한(`MAX_OPEN_DOC_CHARS_PER_BRANCH`)을 넘음 — 큰 파일을 닫아야 한다(§9.10) |

## 파일·경로 규칙

| 대상 | 경로 |
|:---|:---|
| 작업 트리(기본 브랜치) | `<REPO_ROOT>/<node_id>/<repo_name>` (clone 디렉터리 자체가 작업 트리) |
| 작업 트리(그 외 브랜치) | `<REPO_ROOT>/<node_id>/<repo_name>.worktrees/<branch_slug>` |
| `.ydoc` 영속화 | `<REPO_ROOT>/<node_id>/<repo_name>.collab/<branch_slug>/<sha1(path)>.ydoc` |

- `github_branch_slug` 규칙은 SQL(`data/03_func_github.sql`)이 단일 진실이다. collab 은 backend 가 계산해 준 값을 그대로 받는다.
- **Yjs 텍스트는 LF 고정**이다. 파일의 CRLF·BOM 은 doc 생성 시 기억해 두고 flush 때 복원한다(§9.4).
- flush 는 같은 디렉터리의 임시 파일에 쓰고 `rename` 으로 교체한다(원자적).
- 리뷰 데코레이션은 그 파일의 `Y.Doc` 안(`axis:deco` 맵, 값은 JSON 문자열)에 저장한다 — 별도 DB 테이블이 없다.

## 로컬 실행

```bash
cd grad_collab
npm install
npm run build
INTERNAL_TOKEN=dev-token API_BASE=http://127.0.0.1:8080 node dist/server.js
curl -s http://127.0.0.1:3000/healthz
```

## 검사

```bash
npm run check-types        # 타입체크
npm run build              # dist/ 생성
```

## 남은 항목 (2차)

- (없음) 주기적 권한 재확인(§12.9)까지 들어갔다 — 권한을 잃은 우회 클라이언트의 `update` 는 한 주기 안에 막힌다. 남은 후보: 그래프 레인(§15.14, webview 필요), 레퍼런스의 채팅(`ChatPanel`) 이식.