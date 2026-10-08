# grad_collab — Axis Share 협업 문서 서버

VSCode 확장과 backend(C++) 사이에서 **텍스트의 진실**을 갖는 Node.js 프로세스다.
설계는 `TASK_11` §9(상세 설계) / §13(배포) / §14(모듈 구조)를 따른다.

- 하는 일: `(repo, branch, file)` 별 권위 `Y.Doc`, Yjs 병합, 커서·데코 중계, worktree 파일 flush
- 하지 않는 일: git 명령, DB 접근, 사용자 인증(JWT 해석) — 전부 backend 담당

## 환경변수

| 이름 | 기본값 | 설명 |
|:---|:---|:---|
| `PORT` | `3000` | 리스닝 포트(nginx `/collab/` 가 이 포트로 프록시) |
| `API_BASE` | `http://backend:8080` | backend 내부 API 주소 |
| `INTERNAL_TOKEN` | (없음) | backend ↔ collab 내부 인증 토큰. **비어 있으면 모든 티켓을 거부한다(fail-closed)** |
| `REPO_ROOT` | `/app/repository` | 저장소 볼륨 마운트 지점(backend 와 같은 물리 볼륨) |

## 로컬 실행

```bash
cd grad_collab
npm install
npm run build
INTERNAL_TOKEN=dev-token API_BASE=http://127.0.0.1:8080 node dist/server.js
curl -s http://127.0.0.1:3000/healthz
```

## 엔드포인트 (1차)

| Method | 경로 | 설명 |
|:---|:---|:---|
| GET | `/healthz` | 상태(연결 수, 열린 doc 수, 마지막 flush 시각). compose healthcheck 가 사용한다 |
| WS | `/collab/?ticket=<t>` | 문서 소켓. 티켓은 backend 의 `POST /internal/collab/tickets/consume` 로 검증한다 |

- 티켓이 없으면 `401`, 검증에 실패하면 `401`/`503`, backend 가 죽어 있으면 `503`(P0903)을 돌려준다.
- 방 입장(`join`)·문서(`open`/`update`)·`flush` 는 다음 단계에서 구현한다.

## 검사

```bash
npm run check-types   # 타입체크
npm run build         # dist/ 생성
```