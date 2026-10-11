import * as crypto from 'node:crypto';
import * as http from 'node:http';
import * as stream from 'node:stream';
import * as WebSocket from 'ws';
import * as Y from 'yjs';

// ws 의 타입 선언은 클래스와 namespace 가 합쳐진 `export =` 형태다(namespace import 로 받는다).
type WsRawData = WebSocket.RawData;
type WsSocket = WebSocket.WebSocket;

import { CollabAuthError, CollabSession, consumeTicket } from './auth';
import { config } from './config';
import { AcquireResult } from './docRegistry';
import { log } from './logger';
import { isSafeRelPath } from './paths';
import { ClientFrame, parseClientFrame } from './protocol';
import { CollabResolveError, resolveRepo } from './repoResolver';
import { ReviewRecord } from './reviewIndex';
import { Room, RoomClient, RoomRegistry } from './rooms';
import { FileNotEditableError, readForView, removeCollabDir, type ViewFile } from './store';

// 문서 소켓 서버 (TASK_11 §9.2 / §9.5 / §14.1).
//
// 흐름:
//   1. nginx 가 넘긴 `wss://<host>/collab/?ticket=<t>` 업그레이드를 받는다.
//   2. 티켓을 C++ 내부 API 로 검증해 세션(사용자·저장소·권한)을 확정한다.
//   3. join  → backend 내부 API 로 작업 디렉터리를 해석하고 브랜치 방에 들어간다.
//      open  → 파일의 Y.Doc 을 확보하고 초기 상태를 보낸다.
//      update→ Yjs 델타를 적용하고 같은 파일을 보는 사람에게 팬아웃한다.
//      flush → Y.Doc 텍스트를 worktree 파일에 내려쓴다.
//
// 하지 않는 일: JWT 해석, git 명령, DB 접근. 그 셋은 전부 C++ 담당이다(§9.1).

// nginx 의 `location ^~ /collab/` 은 URI 를 그대로 넘긴다(proxy_pass 뒤에 경로가 없다).
// 직접 붙는 경우(호스트 루프백)까지 감안해 몇 가지를 함께 받는다.
const WS_PATHS = new Set(['/collab', '/collab/', '/collab/ws']);

// WS 프로토콜 레벨 ping 주기. nginx 의 proxy_read_timeout(3600s) 안쪽에서 연결을 살려 둔다.
const HEARTBEAT_INTERVAL_MS = 30_000;

const startedAt = Date.now();
const rooms = new RoomRegistry();

let connectionCount = 0;
let clientSeq = 0;

// 권한 없는 편집 시도는 소켓당 1회만 로그에 남긴다(레퍼런스가 같은 로그를 138번 찍었다 — §9.8).
const deniedLogged = new Set<string>();

interface CollabSocket extends WsSocket {
  session?: CollabSession;
  /** WS ping 에 대한 직전 pong 수신 여부. false 인 채로 주기가 돌면 죽은 연결로 본다. */
  isAlive?: boolean;
}

function statusText(status: number): string {
  if (status === 401) return 'Unauthorized';
  if (status === 404) return 'Not Found';
  if (status === 503) return 'Service Unavailable';
  return 'Bad Request';
}

/** 업그레이드 단계에서 거부할 때 쓰는 최소 HTTP 응답. 본문에 오류 코드를 담는다. */
function rejectUpgrade(socket: stream.Duplex, status: number, message: string, code?: string): void {
  const body = JSON.stringify({ status: 'error', code: code ?? String(status), message });
  socket.write(
    `HTTP/1.1 ${status} ${statusText(status)}\r\n` +
      'Content-Type: application/json; charset=utf-8\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n` +
      'Connection: close\r\n\r\n' +
      body,
  );
  socket.destroy();
}

/** ws 가 주는 프레임 조각들을 UTF-8 문자열로 합친다. */
function rawFrameToString(data: WsRawData): string {
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString('utf8');
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8');
  }
  return data.toString('utf8');
}

function errFrame(code: string, message: string, extra?: Record<string, unknown>): Record<string, unknown> {
  return { type: 'err', code, message, ...extra };
}

/** join 없이 open/update 를 보내는 것은 확장 쪽 순서 버그다. 원인이 보이게 알려 준다. */
function requireRoom(client: RoomClient): Room | undefined {
  if (client.room) return client.room;
  client.send(errFrame('400', '먼저 join 으로 브랜치 방에 입장해야 합니다.'));
  return undefined;
}

function logDeniedOnce(client: RoomClient, filePath: string): void {
  if (deniedLogged.has(client.id)) return;
  deniedLogged.add(client.id);
  log('warn', '읽기 전용 세션의 편집 시도 차단', {
    repo: client.session.repoId,
    path: filePath,
    user: client.session.userEmail,
  });
}

// --- 방 입장/퇴장 -------------------------------------------------------------------------

async function onJoin(client: RoomClient, repoId: number, branch: string): Promise<void> {
  // 티켓은 저장소 단위로 발급된다. 세션에 묶인 저장소와 다르면 거부한다.
  if (repoId !== client.session.repoId) {
    client.send(errFrame('P0902', '이 세션으로는 다른 저장소에 접근할 수 없습니다.'));
    return;
  }

  let room: Room;
  try {
    room = rooms.ensure(await resolveRepo(repoId, branch));
  } catch (error) {
    const code = error instanceof CollabResolveError ? error.code : 'P0903';
    log('warn', '방 입장 실패', { repo: repoId, branch, code, reason: (error as Error).message });
    client.send(errFrame(code, (error as Error).message));
    return;
  }

  // 리뷰 인덱스를 **먼저** 읽는다. 방에 붙고 나면 스냅샷과 증분 프레임이 순서대로 도착하므로,
  // 클라이언트는 스냅샷으로 인덱스를 통째로 교체해도 늦게 온 변경을 잃지 않는다(§15.6).
  await room.reviews.ready();

  await attach(client, room);

  // 사이드바가 파일을 열지 않고 목록을 그릴 수 있게 브랜치 리뷰 인덱스를 한 번 보낸다(§15.6).
  client.send({ type: 'reviews', branch: room.repo.branch, reviews: room.reviews.snapshot() });

  // Editing 뷰는 **남의 파일까지** 그려야 한다 — 방에 열려 있는 파일 목록을 한 번 보낸다(§15.5).
  client.send({ type: 'open_files', branch: room.repo.branch, files: room.openFiles() });

  log('info', 'room joined', {
    repo: repoId,
    branch,
    user: client.session.userEmail,
    members: room.clients.size,
  });
}

async function attach(client: RoomClient, room: Room): Promise<void> {
  if (client.room && client.room !== room) {
    await detach(client);
  }
  client.room = room;
  room.clients.add(client);
  client.send({
    type: 'joined',
    branch: room.repo.branch,
    default_branch: room.repo.defaultBranch,
    is_default: room.repo.isDefault,
    can_write: client.session.canWrite,
  });
}

/** 방을 떠난다. 열려 있던 doc 은 grace 안에 다시 들어오면 살아 있고, 아니면 정리된다. */
async function detach(client: RoomClient): Promise<void> {
  const room = client.room;
  if (!room) return;
  client.room = null;

  for (const filePath of room.docs.pathsWatchedBy(client.id)) {
    room.docs.release(filePath, client.id);
    if (room.docs.watchersOf(filePath).some((w) => w.userEmail === client.session.userEmail)) {
      continue; // 같은 사용자의 다른 탭이 아직 보고 있다
    }
    room.presence.removeCursor(filePath, client.session.userEmail);
    room.broadcastWatchers(
      filePath,
      { type: 'peer_leave', path: filePath, userEmail: client.session.userEmail },
      client.id,
    );
    // 떠난 사람도 사이드바에서는 즉시 빠져야 한다(§15.5).
    room.announceFileWatchers(filePath);
  }

  room.clients.delete(client);
  if (room.clients.size === 0) {
    await rooms.close(room);
  }
}

// --- 파일 열기/닫기 ------------------------------------------------------------------------

async function onOpen(client: RoomClient, filePath: string): Promise<void> {
  const room = requireRoom(client);
  if (!room) return;

  if (!isSafeRelPath(filePath)) {
    client.send(errFrame('400', `경로가 올바르지 않습니다: ${filePath}`));
    return;
  }

  let opened: AcquireResult;
  try {
    opened = await room.docs.acquire(filePath, {
      clientId: client.id,
      userEmail: client.session.userEmail,
      userName: client.session.userName,
    });
  } catch (error) {
    // 바이너리·대용량·비 UTF-8·없는 파일은 P0905(읽기 전용 안내), 그 외는 P0906(flush 실패 계열).
    // `path`·`reason` 을 함께 담는다 — 확장은 그 값으로 곧바로 읽기 전용 열람(`read`)으로 넘어간다(§12.6).
    if (error instanceof FileNotEditableError) {
      client.send(errFrame('P0905', error.message, { path: filePath, reason: error.reason }));
      return;
    }
    log('error', '파일 열기 실패', { path: filePath, reason: (error as Error).message });
    client.send(errFrame('P0906', `파일을 열지 못했습니다: ${filePath}`));
    return;
  }

  const entry = opened.entry;
  client.send({
    type: 'opened',
    path: filePath,
    state: opened.state,
    eol: entry.eol,
    can_write: client.session.canWrite,
    mismatch: opened.mismatch,
    watchers: room.docs.watchersOf(filePath).map((w) => ({ email: w.userEmail, name: w.userName })),
  });

  // 늦게 들어온 사람에게 이미 있는 커서를 먼저 보내 준다(커서는 저장하지 않는다 — §8.10).
  for (const cursor of room.presence.listCursors(filePath)) {
    client.send({ type: 'cursor', path: filePath, ...cursor });
  }

  room.broadcastWatchers(
    filePath,
    {
      type: 'peer_join',
      path: filePath,
      userEmail: client.session.userEmail,
      userName: client.session.userName,
    },
    client.id,
  );

  // 사이드바는 이 파일을 열지 않은 사람에게도 보여야 한다 — 참여자 집합을 방 전체에 알린다(§15.5).
  room.announceFileWatchers(filePath);

  if (opened.created) {
    log('info', 'doc opened', {
      repo: room.repo.repoId,
      branch: room.repo.branch,
      path: filePath,
      user: client.session.userEmail,
    });
  }
}

function onClose(client: RoomClient, filePath: string): void {
  const room = requireRoom(client);
  if (!room) return;

  room.docs.release(filePath, client.id);
  if (room.docs.watchersOf(filePath).some((w) => w.userEmail === client.session.userEmail)) {
    return; // 같은 사용자의 다른 탭이 아직 보고 있다
  }

  room.presence.removeCursor(filePath, client.session.userEmail);
  room.broadcastWatchers(
    filePath,
    { type: 'peer_leave', path: filePath, userEmail: client.session.userEmail },
    client.id,
  );
  room.announceFileWatchers(filePath);
}

/**
 * 읽기 전용 열람(§12.6). 편집할 수 없는 파일(바이너리·대용량·비 UTF-8)의 **내용**을 한 번 보내 준다.
 *
 * `open` 과 나눠 둔 이유: `open` 은 Yjs doc 을 만들고 참여자 표시를 바꾸는 **편집 세션**인데,
 * 읽기 전용 파일은 그 둘 다 필요 없다. doc 을 만들지 않으므로 flush 대상도 아니고, 사이드바의
 * "편집 중" 목록에도 뜨지 않는다(§15.5).
 *
 * 내용이 상한(`maxReadOnlyBytes`)을 넘으면 크기만 알린다(`encoding: 'none'`) — 확장은 그때
 * "미리보기를 지원하지 않는다" 안내를 띄운다.
 */
async function onRead(client: RoomClient, filePath: string): Promise<void> {
  const room = requireRoom(client);
  if (!room) return;

  if (!isSafeRelPath(filePath)) {
    client.send(errFrame('400', `경로가 올바르지 않습니다: ${filePath}`));
    return;
  }

  let view: ViewFile;
  try {
    view = await readForView(room.repo.worktreeDir, filePath, config.maxReadOnlyBytes);
  } catch (error) {
    if (error instanceof FileNotEditableError) {
      client.send(errFrame('P0905', error.message, { path: filePath, reason: error.reason }));
      return;
    }
    log('error', '읽기 전용 열람 실패', { path: filePath, reason: (error as Error).message });
    client.send(errFrame('P0906', `파일을 읽지 못했습니다: ${filePath}`));
    return;
  }

  if (view.kind === 'text') {
    client.send({ type: 'file', path: filePath, encoding: 'utf-8', size: view.size, content: view.text });
    return;
  }
  if (view.kind === 'binary') {
    client.send({ type: 'file', path: filePath, encoding: 'base64', size: view.size, content: view.base64 });
    return;
  }

  // 너무 커서 실어 보내지 못했다 — 크기만 알려 준다.
  client.send({ type: 'file', path: filePath, encoding: 'none', size: view.size, content: '' });
}

// --- 실시간 편집 ---------------------------------------------------------------------------

function onUpdate(client: RoomClient, filePath: string, updateBase64: string): void {
  const room = requireRoom(client);
  if (!room) return;

  const entry = room.docs.entry(filePath);
  if (!entry || !entry.watchers.has(client.id)) {
    client.send(errFrame('400', `열지 않은 파일입니다: ${filePath}`));
    return;
  }
  if (!client.session.canWrite) {
    logDeniedOnce(client, filePath);
    client.send(errFrame('P0902', '이 저장소에 편집 권한이 없습니다.'));
    // 통보(`perm`)가 유실되었더라도(끊긴 사이 변경 등) 여기서 확실히 읽기 전용으로 되돌린다(§12.9).
    client.send({ type: 'perm', can_write: false });
    return;
  }

  const bytes = Buffer.from(updateBase64, 'base64');
  if (bytes.length === 0) {
    client.send(errFrame('400', '빈 update 프레임입니다.'));
    return;
  }

  try {
    Y.applyUpdate(entry.doc, new Uint8Array(bytes), client.id);
  } catch (error) {
    client.send(errFrame('400', `Yjs update 를 적용할 수 없습니다: ${(error as Error).message}`));
    return;
  }

  room.docs.touch(filePath);
  room.broadcastWatchers(
    filePath,
    { type: 'update', path: filePath, update: updateBase64, from: client.session.userEmail },
    client.id,
  );
}

/** 커서는 해석하지 않고 그대로 중계한다(§12.8). 서버는 저장하지 않는다. */
function onCursor(client: RoomClient, frame: Extract<ClientFrame, { type: 'cursor' }>): void {
  const room = requireRoom(client);
  if (!room) return;
  if (!room.docs.entry(frame.path)?.watchers.has(client.id)) return;

  const state = {
    userEmail: client.session.userEmail,
    userName: client.session.userName,
    startRel: frame.startRel,
    endRel: frame.endRel,
    activeRel: frame.activeRel,
  };
  room.presence.setCursor(frame.path, state);
  room.broadcastWatchers(frame.path, { type: 'cursor', path: frame.path, ...state }, client.id);
}

/** 데코레이션은 파일의 Y.Doc 안에 저장한다(DB 테이블 없음 — §8.10). 서버는 내용을 해석하지 않는다. */
function onDecoAdd(client: RoomClient, frame: Extract<ClientFrame, { type: 'deco_add' }>): void {
  const room = requireRoom(client);
  if (!room) return;
  if (!room.docs.entry(frame.path)) {
    client.send(errFrame('400', `열지 않은 파일입니다: ${frame.path}`));
    return;
  }
  if (!client.session.canWrite) {
    logDeniedOnce(client, frame.path);
    client.send(errFrame('P0902', '이 저장소에 편집 권한이 없습니다.'));
    return;
  }

  // 클라이언트가 보낸 payload 는 그대로 저장하되, 작성자 정보는 세션 값으로 덮어쓴다(§12.8).
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(frame as unknown as Record<string, unknown>)) {
    if (key === 'type') continue;
    payload[key] = value;
  }
  payload.userEmail = client.session.userEmail;
  payload.userName = client.session.userName;
  // 생성 시각은 서버가 찍는다 — 클라이언트 시계를 신뢰하지 않는다.
  payload.createdAt = new Date().toISOString();

  room.docs.setDecoration(frame.path, frame.id, payload);

  // 사이드바(Reviews)가 쓰는 브랜치 인덱스도 같이 맞춘다(§15.6).
  const record = toReviewRecord(payload);
  if (record.path !== '' && record.id !== '') {
    room.reviews.upsert(record);
  }

  room.broadcastWatchers(frame.path, { type: 'deco', ...payload }, client.id);
}

/** 저장 payload 를 리뷰 인덱스 레코드로 옮긴다. 모양은 `deco` 프레임과 같다(§9.5). */
function toReviewRecord(payload: Record<string, unknown>): ReviewRecord {
  const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
  return {
    path: text(payload.path) ?? '',
    id: text(payload.id) ?? '',
    decoType: text(payload.decoType),
    memo: text(payload.memo),
    line: typeof payload.line === 'number' && Number.isFinite(payload.line) ? payload.line : undefined,
    startRel: payload.startRel,
    endRel: payload.endRel,
    userEmail: text(payload.userEmail) ?? '',
    userName: text(payload.userName),
    createdAt: text(payload.createdAt) ?? new Date().toISOString(),
  };
}

/** 삭제는 누구나 가능하다 — 브랜치 쓰기 권한만 본다(§8.10 확정). */
async function onDecoDel(client: RoomClient, frame: Extract<ClientFrame, { type: 'deco_del' }>): Promise<void> {
  const room = requireRoom(client);
  if (!room) return;
  if (!client.session.canWrite) {
    logDeniedOnce(client, frame.path);
    client.send(errFrame('P0902', '이 저장소에 편집 권한이 없습니다.'));
    return;
  }

  // 파일을 아무도 열고 있지 않아도 지운다 — `.ydoc` 폴백은 docRegistry 가 맡는다(§15.6).
  await room.docs.deleteDecoration(frame.path, frame.id);
  room.reviews.remove(frame.path, frame.id);
  room.broadcastWatchers(
    frame.path,
    { type: 'deco_del', path: frame.path, id: frame.id, userEmail: client.session.userEmail },
    client.id,
  );
}

// --- flush / 브랜치 전환 --------------------------------------------------------------------

async function onFlush(client: RoomClient, filePath: string | undefined): Promise<void> {
  const room = requireRoom(client);
  if (!room) return;
  if (!client.session.canWrite) {
    logDeniedOnce(client, filePath ?? '');
    client.send(errFrame('P0902', '이 저장소에 편집 권한이 없습니다.'));
    return;
  }

  const targets = filePath ? [filePath] : room.docs.paths();
  for (const target of targets) {
    if (!room.docs.has(target)) continue;
    try {
      await room.docs.flush(target);
    } catch (error) {
      log('error', 'flush 실패(요청)', { path: target, reason: (error as Error).message });
      client.send(errFrame('P0906', `파일을 저장하지 못했습니다: ${target}`));
      return;
    }
    client.send({ type: 'flushed', path: target });
  }
}

/** 브랜치 전환은 "내려쓰고 → 나가고 → 새 방에 들어가기"다(§9.7). */
async function onSwitchBranch(
  client: RoomClient,
  repoId: number,
  from: string,
  to: string,
): Promise<void> {
  const room = requireRoom(client);
  if (!room) return;
  if (room.repo.repoId !== repoId || room.repo.branch !== from) {
    client.send(errFrame('400', `현재 브랜치와 일치하지 않습니다: ${from}`));
    return;
  }

  await room.docs.flushAll();
  await detach(client);
  await onJoin(client, repoId, to);
}

function handleFrame(client: RoomClient, frame: ClientFrame): Promise<void> | void {
  switch (frame.type) {
    case 'join':
      return onJoin(client, frame.repo_id, frame.branch);
    case 'open':
      return onOpen(client, frame.path);
    case 'close':
      return onClose(client, frame.path);
    case 'read':
      return onRead(client, frame.path);
    case 'update':
      return onUpdate(client, frame.path, frame.update);
    case 'cursor':
      return onCursor(client, frame);
    case 'deco_add':
      return onDecoAdd(client, frame);
    case 'deco_del':
      return onDecoDel(client, frame);
    case 'flush':
      return onFlush(client, frame.path);
    case 'switch_branch':
      return onSwitchBranch(client, frame.repo_id, frame.from, frame.to);
  }
}

// --- 내부 HTTP API (C++ → collab) -----------------------------------------------------------

// 되돌리기 통보(§12.11.1). C++ 이 HEAD 내용(또는 "지워라")을 만들어 넘기면, 열려 있는 doc 을 그 내용으로 맞춘다.
// nginx 는 /internal/* 를 404 로 막고, collab 은 compose 내부망에서만 닿는다. 그 위에 토큰까지 본다.
const RESET_PATH = '/internal/collab/files/reset';
const FLUSH_PATH = '/internal/collab/flush';
const DROP_PATH = '/internal/collab/files/drop';
const BRANCH_DROP_PATH = '/internal/collab/branch/drop';
const PERMISSION_PATH = '/internal/collab/permission';
// 저장소 닫기 통보(노드 삭제, §12.9). 저장소 여러 개를 한 번에 받는다.
const REPO_CLOSE_PATH = '/internal/collab/repo/close';
const MAX_BODY_BYTES = 16 * 1024 * 1024;

/** 내부 토큰을 상수 시간으로 비교한다(fail-closed — 토큰이 없으면 아무 요청도 받지 않는다). */
function internalAuthorized(req: http.IncomingMessage): boolean {
  const configured = config.internalToken;
  if (configured.length === 0) return false;
  const header = req.headers['x-internal-token'];
  const presented = Array.isArray(header) ? header[0] : header;
  if (typeof presented !== 'string' || presented.length !== configured.length) return false;
  return crypto.timingSafeEqual(Buffer.from(presented, 'utf8'), Buffer.from(configured, 'utf8'));
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new Error('본문이 너무 큽니다.');
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString('utf8');
}

interface ResetFile {
  path: string;
  text?: string;
  deleted?: boolean;
}

/** 되돌리기 요청 하나를 처리한다. 열려 있지 않은 경로는 건드리지 않는다(다음 open 이 파일에서 새로 만든다). */
async function handleResetRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!internalAuthorized(req)) {
    log('warn', '되돌리기 통보 거부: 내부 토큰이 설정되지 않았거나 일치하지 않습니다.');
    sendJson(res, 401, { status: 'error', code: '401', message: '내부 인증에 실패했습니다.' });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBody(req));
  } catch (error) {
    sendJson(res, 400, { status: 'error', code: '400', message: `요청 본문을 읽지 못했습니다: ${(error as Error).message}` });
    return;
  }

  const body = parsed as { repo_id?: unknown; branch?: unknown; files?: unknown };
  const repoId = typeof body.repo_id === 'number' ? body.repo_id : Number.NaN;
  const branch = typeof body.branch === 'string' ? body.branch : '';
  const files = Array.isArray(body.files) ? (body.files as ResetFile[]) : [];
  if (!Number.isInteger(repoId) || branch.length === 0) {
    sendJson(res, 400, { status: 'error', code: '400', message: 'repo_id 와 branch 가 필요합니다.' });
    return;
  }

  const room = rooms.get(repoId, branch);
  if (!room) {
    // 아무도 이 브랜치를 보고 있지 않다 — 메모리에 doc 이 없으므로 되돌릴 것도 없다.
    sendJson(res, 200, { status: 'success', data: [{ applied: 0, deleted: 0 }], message: '열린 문서가 없습니다.' });
    return;
  }

  let applied = 0;
  let deleted = 0;
  for (const file of files) {
    if (!file || typeof file.path !== 'string' || !isSafeRelPath(file.path)) continue;

    if (file.deleted === true) {
      const watchers = room.docs.watchersOf(file.path).map((w) => w.clientId);
      if (await room.docs.dropDoc(file.path)) {
        room.sendTo(watchers, { type: 'doc_reset', path: file.path, deleted: true });
        room.announceFileWatchers(file.path); // doc 이 버려졌으니 열린 목록에서도 빠진다(§15.5)
        deleted += 1;
      }
      continue;
    }

    if (typeof file.text === 'string') {
      const update = room.docs.resetText(file.path, file.text);
      if (update) {
        room.broadcastWatchers(file.path, {
          type: 'update',
          path: file.path,
          update: Buffer.from(update).toString('base64'),
        });
        applied += 1;
      }
      // 되돌린 내용을 디스크에 내려놓을 때까지 기다린다. 응답을 받은 C++ 이 곧바로 git 체크아웃을 돌리는데,
      // git 은 그 경로가 비어 있다고 본 뒤 O_CREAT|O_EXCL 로 만든다 — 여기서 기다리지 않으면 이 쓰기와 겹쳐
      // `unable to create file <path>: File exists` 로 죽는다(§12.11.1).
      await room.docs.flush(file.path).catch(() => undefined);
    }
  }

  log('info', '되돌리기 적용', { repo: repoId, branch, applied, deleted });
  sendJson(res, 200, { status: 'success', data: [{ applied, deleted }], message: '되돌렸습니다.' });
}

/**
 * 강제 flush(§12.11). C++ 이 커밋·스테이징 **직전**에 부른다 — 편집은 디바운스(기본 2초) 뒤에
 * 파일로 내려가므로, 기다리지 않고 git 을 돌리면 마지막 편집이 커밋·인덱스에서 빠진다. 응답은
 * "이 브랜치의 열린 doc 을 전부 내려쓰려고 시도했다" 는 뜻이고, 파일별 실패는 여기 로그에 남는다
 * (호출자를 막지는 않는다).
 */
async function handleFlushRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!internalAuthorized(req)) {
    log('warn', 'flush 요청 거부: 내부 토큰이 설정되지 않았거나 일치하지 않습니다.');
    sendJson(res, 401, { status: 'error', code: '401', message: '내부 인증에 실패했습니다.' });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBody(req));
  } catch (error) {
    sendJson(res, 400, { status: 'error', code: '400', message: `요청 본문을 읽지 못했습니다: ${(error as Error).message}` });
    return;
  }

  const body = parsed as { repo_id?: unknown; branch?: unknown };
  const repoId = typeof body.repo_id === 'number' ? body.repo_id : Number.NaN;
  const branch = typeof body.branch === 'string' ? body.branch : '';
  if (!Number.isInteger(repoId) || branch.length === 0) {
    sendJson(res, 400, { status: 'error', code: '400', message: 'repo_id 와 branch 가 필요합니다.' });
    return;
  }

  const room = rooms.get(repoId, branch);
  if (!room) {
    // 열린 doc 이 없다 — 파일은 이미 최신이므로 내려쓸 것도 없다.
    sendJson(res, 200, { status: 'success', data: [{ flushed: 0, failed: 0 }], message: '열린 문서가 없습니다.' });
    return;
  }

  const paths = room.docs.paths();
  const failed: string[] = [];
  for (const filePath of paths) {
    try {
      await room.docs.flush(filePath);
    } catch (error) {
      // 파일 하나가 실패해도 나머지는 계속 내려쓴다(호출자가 로그로 확인한다).
      failed.push(filePath);
      log('error', '강제 flush 실패', { path: filePath, reason: (error as Error).message });
    }
  }

  if (failed.length > 0) {
    log('warn', '강제 flush 일부 실패', { repo: repoId, branch, failed });
  } else {
    log('info', '강제 flush', { repo: repoId, branch, flushed: paths.length });
  }
  sendJson(res, 200, {
    status: 'success',
    data: [{ flushed: paths.length - failed.length, failed: failed.length }],
    message: '내려썼습니다.',
  });
}


/**
 * 파일 삭제·이름변경 통보(§12.5). C++ 이 git 작업(git rm / git mv)을 **끝낸 뒤** 부른다 —
 * 여기서는 열려 있는 doc 과 `.ydoc`, 그리고 그 파일의 리뷰를 버린다.
 * 남겨 두면 다음 flush 가 지운 파일이나 옛 경로를 되살린다.
 *
 * 경로가 디렉터리면 그 아래 doc 도 함께 버린다(트리에서 디렉터리를 통째로 지울 수 있다).
 */
async function handleDropRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!internalAuthorized(req)) {
    log('warn', 'doc 정리 요청 거부: 내부 토큰이 설정되지 않았거나 일치하지 않습니다.');
    sendJson(res, 401, { status: 'error', code: '401', message: '내부 인증에 실패했습니다.' });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBody(req));
  } catch (error) {
    sendJson(res, 400, { status: 'error', code: '400', message: `요청 본문을 읽지 못했습니다: ${(error as Error).message}` });
    return;
  }

  const body = parsed as { repo_id?: unknown; branch?: unknown; paths?: unknown };
  const repoId = typeof body.repo_id === 'number' ? body.repo_id : Number.NaN;
  const branch = typeof body.branch === 'string' ? body.branch : '';
  const paths = Array.isArray(body.paths)
    ? body.paths.filter((item): item is string => typeof item === 'string')
    : [];
  if (!Number.isInteger(repoId) || branch.length === 0) {
    sendJson(res, 400, { status: 'error', code: '400', message: 'repo_id 와 branch 가 필요합니다.' });
    return;
  }

  const room = rooms.get(repoId, branch);
  if (!room) {
    // 방이 없으면 메모리 doc 도 없었으므로 버릴 것도 없다(다음 open 이 파일에서 새로 만든다).
    sendJson(res, 200, { status: 'success', data: [{ dropped: 0 }], message: '열린 문서가 없습니다.' });
    return;
  }

  let dropped = 0;
  for (const target of paths) {
    if (!isSafeRelPath(target)) continue;

    // 디렉터리 삭제·이동이면 그 아래 doc 도 함께 버린다.
    const affected = new Set<string>([target]);
    for (const openPath of room.docs.paths()) {
      if (openPath === target || openPath.startsWith(`${target}/`)) affected.add(openPath);
    }

    for (const filePath of affected) {
      const watchers = room.docs.watchersOf(filePath);
      const clientIds = await room.docs.forget(filePath);
      room.reviews.removePath(filePath);
      for (const watcher of watchers) {
        room.presence.removeCursor(filePath, watcher.userEmail);
      }
      if (clientIds.length > 0) {
        // 열려 있던 탭은 닫는다 — 경로가 사라졌으니 내용을 더 보여 줄 수 없다(§12.5).
        // `reason` 을 붙여 "되돌리기" 안내 문구를 쓰지 않게 한다.
        room.sendTo(clientIds, { type: 'doc_reset', path: filePath, deleted: true, reason: 'tree_changed' });
        dropped += 1;
      }
      // 사라진 파일은 방의 열린 목록에서도 빠진다(§15.5).
      room.announceFileWatchers(filePath);
    }
  }

  // 그 경로의 리뷰도 함께 사라졌을 수 있다 — 사이드바(Reviews)가 통째로 다시 그리도록 스냅샷을 보낸다(§15.6).
  if (paths.length > 0) {
    room.broadcast({ type: 'reviews', branch: room.repo.branch, reviews: room.reviews.snapshot() });
  }

  log('info', 'doc 정리(트리 변경)', { repo: repoId, branch, targets: paths.length, dropped });
  sendJson(res, 200, { status: 'success', data: [{ dropped }], message: '문서를 정리했습니다.' });
}
/**
 * 브랜치 삭제 통보(§9.7). C++ 가 그 브랜치의 worktree 를 지우기 **전에** 부른다.
 *
 * 방을 버리고(내려쓰지 않는다) 브랜치 디렉터리(`.ydoc`·`reviews.json`)를 통째로 지운다.
 * 남겨 두면 (가) 남은 doc 의 flush 가 사라진 작업 디렉터리를 되살리고,
 * (나) 같은 이름의 브랜치를 다시 만들었을 때 열기(§9.3 — `.ydoc` 우선)가 옛 내용을 되살린다.
 */
async function handleBranchDropRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!internalAuthorized(req)) {
    log('warn', '브랜치 정리 요청 거부: 내부 토큰이 설정되지 않았거나 일치하지 않습니다.');
    sendJson(res, 401, { status: 'error', code: '401', message: '내부 인증에 실패했습니다.' });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBody(req));
  } catch (error) {
    sendJson(res, 400, { status: 'error', code: '400', message: `요청 본문을 읽지 못했습니다: ${(error as Error).message}` });
    return;
  }

  const body = parsed as { repo_id?: unknown; branch?: unknown };
  const repoId = typeof body.repo_id === 'number' ? body.repo_id : Number.NaN;
  const branch = typeof body.branch === 'string' ? body.branch : '';
  if (!Number.isInteger(repoId) || branch.length === 0) {
    sendJson(res, 400, { status: 'error', code: '400', message: 'repo_id 와 branch 가 필요합니다.' });
    return;
  }

  // 방이 없어도(편집자가 아무도 없었어도) `.ydoc` 은 브랜치 디렉터리에 남아 있다 — 경로는 backend 에서 받는다.
  const room = rooms.get(repoId, branch);
  let collabDir = room?.repo.collabDir;
  if (!collabDir) {
    try {
      collabDir = (await resolveRepo(repoId, branch)).collabDir;
    } catch (error) {
      // 이미 브랜치가 사라졌다면 지울 대상도 없다 — worktree 정리를 막지 않도록 성공으로 답한다.
      log('warn', '브랜치 상태 정리 건너뜀(경로 해석 실패)', {
        repo: repoId,
        branch,
        reason: (error as Error).message,
      });
      sendJson(res, 200, {
        status: 'success',
        data: [{ discarded_docs: 0, removed: false }],
        message: '정리할 상태가 없습니다.',
      });
      return;
    }
  }

  const discarded = room ? room.docs.openCount : 0;
  if (room) {
    await rooms.abandon(room);
  }
  await removeCollabDir(collabDir).catch((error: unknown) => {
    log('error', '브랜치 상태 삭제 실패', { repo: repoId, branch, reason: (error as Error).message });
  });

  log('info', '브랜치 상태 정리(브랜치 삭제)', { repo: repoId, branch, discarded });
  sendJson(res, 200, {
    status: 'success',
    data: [{ discarded_docs: discarded, removed: true }],
    message: '브랜치 상태를 정리했습니다.',
  });
}

/**
 * 권한을 잃은 사용자를 그 저장소의 방에서 내보낸다(보기 권한 상실, §12.9).
 *
 * `repo_closed` 를 그 사람에게만 보내고 소켓을 닫은 뒤 **즉시 방에서 뗀다.** 소켓 종료 이벤트는
 * 큐를 거쳐 늦게 도착하므로, 그 전에 `detach` 가 한 번 돌아야 남은 사람의 파일 참여자 목록
 * (`peer_leave`)이 바로 갱신된다. 방 자체는 없애지 않는다 — 남은 접속자가 계속 쓰는 방이고,
 * 마지막 사람이 나갈 때 `detach` 규칙으로 정리(내려쓰기 포함)된다.
 *
 * `closeRepo`(노드 삭제)와 달리 저장소 전체를 닫지 않는다. 잃은 것은 그 사람의 권한뿐이다.
 */
async function evictUsers(repoId: number, userEmails: Set<string>, reason: string, message: string): Promise<number> {
  let evicted = 0;
  for (const room of rooms.ofRepo(repoId)) {
    const targets = [...room.clients].filter((client) => userEmails.has(client.session.userEmail));
    if (targets.length === 0) continue;

    room.sendTo(targets.map((client) => client.id), { type: 'repo_closed', repo_id: repoId, reason, message });
    for (const client of targets) {
      client.close(1000, reason);
      await detach(client);
      evicted += 1;
    }
  }
  return evicted;
}

/**
 * 권한 변경 통보(TASK_11 §12.9). C++ 이 "이 사용자의 권한이 이렇게 바뀌었다"를 확정해 넘기면,
 * 그 저장소 방의 해당 세션에 반영한다.
 *
 * collab 은 권한을 판정하지 않는다 — 받은 값을 세션에 반영하고 클라이언트에 전달할 뿐이다. 값이
 * 그대로인 세션에는 프레임을 보내지 않는다(같은 값을 중복 통보해도 화면이 흔들리지 않게).
 * 끊겨 가는 소켓은 `send` 가 조용히 버리므로 여기서 따로 걸러내지 않는다.
 *
 * 두 값의 처리가 다르다(§12.9).
 *   - `can_write=false`: `perm` 으로 알려 확장이 읽기 전용으로 전환한다. 세션은 살려 둔다 —
 *     대개 일시적이고 곧 복구된다.
 *   - `can_view=false` : 그 저장소를 더 이상 볼 수 없다는 뜻이다. **세션을 끝낸다.** 읽기만
 *     막고 남겨 두면 못 보는 저장소의 편집을 계속 받는다.
 */
async function handlePermissionRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!internalAuthorized(req)) {
    log('warn', '권한 통보 요청 거부: 내부 토큰이 설정되지 않았거나 일치하지 않습니다.');
    sendJson(res, 401, { status: 'error', code: '401', message: '내부 인증에 실패했습니다.' });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBody(req));
  } catch (error) {
    sendJson(res, 400, { status: 'error', code: '400', message: '요청 본문을 읽지 못했습니다: ' + (error as Error).message });
    return;
  }

  const body = parsed as { repo_id?: unknown; users?: unknown };
  const repoId = typeof body.repo_id === 'number' ? body.repo_id : Number.NaN;
  if (!Number.isInteger(repoId)) {
    sendJson(res, 400, { status: 'error', code: '400', message: 'repo_id 가 필요합니다.' });
    return;
  }

  // can_view 를 보내지 않은 통보는 "그대로"로 본다 — 모르는 값으로 남의 세션을 끊지 않는다.
  const targets = new Map<string, { canView: boolean; canWrite: boolean }>();
  if (Array.isArray(body.users)) {
    for (const raw of body.users as Array<{ user_email?: unknown; can_view?: unknown; can_write?: unknown }>) {
      if (!raw || typeof raw.user_email !== 'string' || raw.user_email.length === 0) continue;
      targets.set(raw.user_email, { canView: raw.can_view !== false, canWrite: raw.can_write === true });
    }
  }
  if (targets.size === 0) {
    sendJson(res, 400, { status: 'error', code: '400', message: '갱신할 사용자 목록이 필요합니다.' });
    return;
  }

  const lostView = new Set<string>();
  let updated = 0;
  let revoked = 0;
  for (const room of rooms.ofRepo(repoId)) {
    // 방에서 떼는 일은 순회가 끝난 뒤에 한다 — 순회 중에 방 구성이 바뀌지 않게.
    for (const client of [...room.clients]) {
      const target = targets.get(client.session.userEmail);
      if (!target) continue;
      if (!target.canView) {
        lostView.add(client.session.userEmail);
        continue;
      }
      if (client.session.canWrite === target.canWrite) continue;
      client.session.canWrite = target.canWrite;
      client.send({ type: 'perm', can_write: target.canWrite });
      updated += 1;
      if (!target.canWrite) revoked += 1;
    }
  }

  const evicted = lostView.size === 0
    ? 0
    : await evictUsers(repoId, lostView, 'authority_lost', '이 워크스페이스에 대한 권한이 없어 편집 세션을 종료했습니다.');

  log('info', '권한 변경 통보', { repo: repoId, updated, revoked, evicted, users: targets.size });
  sendJson(res, 200, {
    status: 'success',
    data: [{ updated, revoked, evicted }],
    message: '권한 변경을 통보했습니다.',
  });
}

/**
 * 저장소 닫기 통보(TASK_11 §12.9). C++ 이 노드 삭제를 마친 뒤 부른다.
 *
 * 노드는 소프트 딜리트라 저장소 행이 남는다. 그래서 "지금 붙어 있는 세션을 끊는 일"과 "다시 못
 * 붙게 막는 일"을 나눠서 한다 — collab 은 전자만 한다(후자는 접속 등록·경로 해석의 P0815 가 막는다).
 * 저장소 방을 파일로 내려쓴 뒤(편집 보존) 접속자에게 `repo_closed` 를 보내고 소켓을 닫는다.
 *
 * collab 은 판정하지 않는다 — C++ 이 준 repo_id 목록을 그대로 집행할 뿐이다(§9.1 의 경계).
 */
async function handleRepoCloseRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  if (!internalAuthorized(req)) {
    log('warn', '저장소 닫기 요청 거부: 내부 토큰이 설정되지 않았거나 일치하지 않습니다.');
    sendJson(res, 401, { status: 'error', code: '401', message: '내부 인증에 실패했습니다.' });
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await readBody(req));
  } catch (error) {
    sendJson(res, 400, { status: 'error', code: '400', message: '요청 본문을 읽지 못했습니다: ' + (error as Error).message });
    return;
  }

  const body = parsed as { repo_ids?: unknown; reason?: unknown };
  const repoIds = Array.isArray(body.repo_ids)
    ? body.repo_ids.filter((item): item is number => typeof item === 'number' && Number.isInteger(item) && item > 0)
    : [];
  if (repoIds.length === 0) {
    sendJson(res, 400, { status: 'error', code: '400', message: 'repo_ids 배열이 필요합니다.' });
    return;
  }

  // close reason 은 WebSocket 규격상 ASCII·123바이트 이하다. 사람이 읽는 문구는 별도 프레임(repo_closed)으로 간다.
  const reason = typeof body.reason === 'string' && body.reason.length > 0 ? body.reason : 'repo_closed';
  const message = '워크스페이스가 삭제되어 편집 세션을 종료했습니다.';

  let closedRooms = 0;
  let closedClients = 0;
  for (const repoId of repoIds) {
    const closed = await rooms.closeRepo(repoId, reason, message);
    closedRooms += closed.rooms;
    closedClients += closed.clients;
    if (closed.rooms > 0) {
      log('info', '저장소 방 닫음(노드 삭제)', { repo: repoId, rooms: closed.rooms, clients: closed.clients });
    }
  }

  log('info', '저장소 닫기 통보 완료', { repos: repoIds.length, rooms: closedRooms, clients: closedClients });
  sendJson(res, 200, {
    status: 'success',
    data: [{ repos: repoIds.length, rooms_closed: closedRooms, clients_closed: closedClients }],
    message: '저장소 세션을 닫았습니다.',
  });
}

// --- HTTP(healthz) + 업그레이드 -------------------------------------------------------------


const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === RESET_PATH) {
    void handleResetRequest(req, res).catch((error: unknown) => {
      log('error', '되돌리기 처리 실패', { reason: (error as Error).message });
      sendJson(res, 500, { status: 'error', code: '500', message: '되돌리기를 처리하지 못했습니다.' });
    });
    return;
  }

  if (req.method === 'POST' && req.url === FLUSH_PATH) {
    void handleFlushRequest(req, res).catch((error: unknown) => {
      log('error', 'flush 처리 실패', { reason: (error as Error).message });
      sendJson(res, 500, { status: 'error', code: '500', message: 'flush 를 처리하지 못했습니다.' });
    });
    return;
  }

  if (req.method === 'POST' && req.url === DROP_PATH) {
    void handleDropRequest(req, res).catch((error: unknown) => {
      log('error', 'doc 정리 처리 실패', { reason: (error as Error).message });
      sendJson(res, 500, { status: 'error', code: '500', message: '문서를 정리하지 못했습니다.' });
    });
    return;
  }

  if (req.method === 'POST' && req.url === BRANCH_DROP_PATH) {
    void handleBranchDropRequest(req, res).catch((error: unknown) => {
      log('error', '브랜치 정리 처리 실패', { reason: (error as Error).message });
      sendJson(res, 500, { status: 'error', code: '500', message: '브랜치 상태를 정리하지 못했습니다.' });
    });
    return;
  }

  if (req.method === 'POST' && req.url === PERMISSION_PATH) {
    void handlePermissionRequest(req, res).catch((error: unknown) => {
      log('error', '권한 통보 처리 실패', { reason: (error as Error).message });
      sendJson(res, 500, { status: 'error', code: '500', message: '권한 변경을 통보하지 못했습니다.' });
    });
    return;
  }

  if (req.method === 'POST' && req.url === REPO_CLOSE_PATH) {
    void handleRepoCloseRequest(req, res).catch((error: unknown) => {
      log('error', '저장소 닫기 처리 실패', { reason: (error as Error).message });
      sendJson(res, 500, { status: 'error', code: '500', message: '저장소 세션을 닫지 못했습니다.' });
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        status: 'ok',
        uptime_s: Math.floor((Date.now() - startedAt) / 1000),
        ws_connections: connectionCount,
        rooms: rooms.roomCount,
        open_docs: rooms.openDocs,
        last_flush_at: rooms.lastFlushAt(),
        internal_token_configured: config.internalToken.length > 0,
      }),
    );
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ status: 'error', code: '404', message: 'Not Found' }));
});

const wss = new WebSocket.WebSocketServer({ noServer: true, maxPayload: 8 * 1024 * 1024 });

server.on('upgrade', (req: http.IncomingMessage, socket: stream.Duplex, head: Buffer) => {
  const url = new URL(req.url ?? '/', 'http://collab');
  if (!WS_PATHS.has(url.pathname)) {
    rejectUpgrade(socket, 404, '알 수 없는 경로입니다.');
    return;
  }

  const ticket = url.searchParams.get('ticket') ?? '';
  if (ticket.length === 0) {
    rejectUpgrade(socket, 401, 'ticket 파라미터가 필요합니다.', 'P0901');
    return;
  }

  // 티켓 검증은 네트워크 호출이라 비동기다. 그 사이 소켓 오류가 나면 조용히 정리한다.
  socket.on('error', () => socket.destroy());

  void (async () => {
    let session: CollabSession;
    try {
      session = await consumeTicket(ticket);
    } catch (error) {
      const authError = error as CollabAuthError;
      log('warn', 'ticket rejected', { reason: authError.message, code: authError.code });
      rejectUpgrade(socket, authError.status ?? 401, authError.message, authError.code);
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      (ws as CollabSocket).session = session;
      wss.emit('connection', ws, req);
    });
  })();
});

wss.on('connection', (ws: WsSocket) => {
  const socket = ws as CollabSocket;
  const session = socket.session;
  if (!session) {
    // 정상 경로에서는 항상 있다. 없다면 위 업그레이드 처리 버그이므로 즉시 끊는다.
    ws.close(1011, 'session missing');
    return;
  }

  connectionCount += 1;
  socket.isAlive = true;
  ws.on('pong', () => {
    socket.isAlive = true;
  });

  const client: RoomClient = {
    id: `c${++clientSeq}`,
    session,
    room: null,
    send(frame: unknown): void {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(frame));
      }
    },
    close(code: number, reason: string): void {
      try {
        ws.close(code, reason);
      } catch {
        // 이미 닫히는 중인 소켓이다 — 정리(close 콜백)는 그대로 진행된다.
      }
    },
  };

  // 프레임은 소켓별로 순서대로 처리한다. open 이 끝나기 전에 update 가 끼어들면 안 된다(§9.6).
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (work: () => Promise<void> | void): void => {
    queue = queue.then(work).catch((error: unknown) => {
      log('error', '프레임 처리 실패', { user: session.userEmail, reason: (error as Error).message });
    });
  };

  log('info', 'collab socket connected', {
    user: session.userEmail,
    repo: session.repoId,
    can_write: session.canWrite,
    connections: connectionCount,
  });

  ws.on('message', (data: WsRawData, isBinary: boolean) => {
    if (isBinary) {
      // 1차는 JSON 텍스트 프레임만 쓴다(§9.5).
      client.send(errFrame('400', '바이너리 프레임은 지원하지 않습니다.'));
      return;
    }

    const parsed = parseClientFrame(rawFrameToString(data));
    if (!parsed.ok) {
      log('warn', 'invalid frame', { user: session.userEmail, code: parsed.code, reason: parsed.message });
      client.send(errFrame(parsed.code, parsed.message));
      return;
    }

    enqueue(() => handleFrame(client, parsed.frame));
  });

  ws.on('close', (code: number) => {
    connectionCount -= 1;
    deniedLogged.delete(client.id);
    // 남은 방·doc 정리는 순서를 지켜야 하므로 큐에 태운다.
    enqueue(async () => {
      await detach(client);
    });
    log('info', 'collab socket closed', { user: session.userEmail, repo: session.repoId, code });
  });

  ws.on('error', (error: Error) => {
    log('warn', 'collab socket error', { user: session.userEmail, reason: error.message });
  });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    const socket = ws as CollabSocket;
    if (socket.isAlive === false) {
      socket.terminate();
      continue;
    }
    socket.isAlive = false;
    socket.ping();
  }
}, HEARTBEAT_INTERVAL_MS);

async function shutdown(signal: string): Promise<void> {
  log('info', `shutdown (${signal})`);
  clearInterval(heartbeat);
  try {
    // 마지막 flush 를 남기고 내려간다(§9.9).
    await rooms.disposeAll();
  } catch (error) {
    log('error', 'shutdown flush 실패', { reason: (error as Error).message });
  }
  for (const ws of wss.clients) {
    ws.close(1001, 'server shutdown');
  }
  wss.close(() => {
    server.close(() => process.exit(0));
  });
  // 정리가 늦어져도 컨테이너 종료를 붙잡지 않는다.
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

server.listen(config.port, () => {
  log('info', 'collab listening', {
    port: config.port,
    api_base: config.apiBase,
    repo_root: config.repoRoot,
    internal_token_configured: config.internalToken.length > 0,
  });
  if (config.internalToken.length === 0) {
    log('error', 'INTERNAL_TOKEN 이 없어 모든 티켓을 거부합니다(fail-closed).');
  }
});