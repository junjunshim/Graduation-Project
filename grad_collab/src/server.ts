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
import { Room, RoomClient, RoomRegistry } from './rooms';
import { FileNotEditableError } from './store';

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

function errFrame(code: string, message: string): Record<string, unknown> {
  return { type: 'err', code, message };
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

  await attach(client, room);
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
    if (error instanceof FileNotEditableError) {
      client.send(errFrame('P0905', error.message));
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
    mismatch: entry.mismatch,
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

  room.docs.setDecoration(frame.path, frame.id, payload);
  room.broadcastWatchers(frame.path, { type: 'deco', ...payload }, client.id);
}

/** 삭제는 누구나 가능하다 — 브랜치 쓰기 권한만 본다(§8.10 확정). */
function onDecoDel(client: RoomClient, frame: Extract<ClientFrame, { type: 'deco_del' }>): void {
  const room = requireRoom(client);
  if (!room) return;
  if (!client.session.canWrite) {
    logDeniedOnce(client, frame.path);
    client.send(errFrame('P0902', '이 저장소에 편집 권한이 없습니다.'));
    return;
  }

  room.docs.deleteDecoration(frame.path, frame.id);
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

// --- HTTP(healthz) + 업그레이드 -------------------------------------------------------------

const server = http.createServer((req, res) => {
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