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

- 티켓이 없으면 `401`, 검증 실패 `401`/`503`, backend 가 죽어 있으면 `503`(P0903).
- collab 은 외부에 직접 노출하지 않는다. nginx `location ^~ /collab/` 만 연다.

## 문서 소켓 프로토콜

프레임은 **JSON 텍스트 + base64** 다(§9.5, 1차). 크기 상한 4MB.

클라이언트 → collab:

| type | payload | 설명 |
|:---|:---|:---|
| `join` | `{ repo_id, branch }` | 브랜치 방 입장(방이 없으면 만든다) |
| `open` | `{ path }` | 파일 doc 참여(없으면 worktree 파일에서 생성) |
| `close` | `{ path }` | 파일 doc 이탈 |
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
| `update` | `{ path, update, from }` | 같은 파일 편집자에게 팬아웃 |
| `cursor` | `{ path, userEmail, userName, startRel, endRel, activeRel }` | 팬아웃 |
| `deco` | `{ path, id, userEmail, userName, ... }` | 팬아웃(작성자는 세션 값으로 확정) |
| `deco_del` | `{ path, id, userEmail }` | 팬아웃 |
| `flushed` | `{ path }` | flush 완료(커밋 전 대기 해제) |
| `peer_join` / `peer_leave` | `{ path, userEmail, userName? }` | **파일 doc 참여자** 변동 |
| `err` | `{ code, message }` | 오류(P09xx) |

- **`opened` 를 받은 뒤에만 `update` 를 보낸다**(§9.6). 소켓별로 프레임을 순서대로 처리한다.
- `opened.state` 에는 텍스트뿐 아니라 **데코레이션도 함께 들어 있다**(같은 `Y.Doc` 상태).
- `opened.mismatch=true` 는 "영속화된 doc 과 worktree 파일이 달라 doc 을 우선했다"는 표시다(§9.3). 자동 병합하지 않는다.

### 오류 코드 (P09xx)

| 코드 | 의미 |
|:---|:---|
| `P0901` | 티켓이 만료되었거나 이미 사용됨 |
| `P0902` | 이 저장소에 편집 권한이 없음(read-only 티켓) |
| `P0903` | 협업 서버를 사용할 수 없음(내부 토큰 미설정·backend 연결 실패) |
| `P0905` | 편집할 수 없는 파일(없음·바이너리·512KB 초과·비 UTF-8) |
| `P0906` | flush 실패 / 파일을 열지 못함 |
| `P0801` | 등록되지 않은 저장소·브랜치 |
| `P0807` | 저장소 경로 정보가 올바르지 않거나 작업 디렉터리가 준비되지 않음 |

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

## 아직 구현하지 않은 것 (다음 단계)

- `POST /internal/collab/flush` — 커밋 직전 backend 가 강제 flush 를 요청하는 내부 API(§12.11).
- 파일 생성·삭제·이름변경(`/api/collab/files`, §12.5) 및 트리 변경 이벤트 중계.
- `branch_deleted` 이벤트 처리(그 브랜치 doc 정리·`.ydoc` 삭제, §9.7).
- `perm` 프레임 — 작업 중 권한 회수 통보(§12.9).