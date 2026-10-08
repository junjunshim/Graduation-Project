import * as http from 'node:http';
import * as stream from 'node:stream';
import * as WebSocket from 'ws';

// ws 의 타입 선언은 클래스와 namespace 가 합쳐진 `export =` 형태다(namespace import 로 받는다).
type WsRawData = WebSocket.RawData;
type WsSocket = WebSocket.WebSocket;

import { CollabAuthError, CollabSession, consumeTicket } from './auth';
import { config } from './config';
import { log } from './logger';
import { parseClientFrame } from './protocol';

// 문서 소켓 부트스트랩 (TASK_11 §9.2 / §14.1).
//
// 하는 일:
//   1. nginx 가 넘긴 `wss://<host>/collab/?ticket=<t>` 업그레이드를 받는다.
//   2. 티켓을 C++ 내부 API 로 검증해 세션을 확정한다. (실패하면 소켓을 401 로 끊는다)
//   3. 연결을 유지한다. 방·문서(Yjs)·파일 flush 는 다음 단계에서 이 위에 얹는다.
//
// 하지 않는 일: JWT 해석, git 명령, DB 접근. 그 셋은 전부 C++ 담당이다(§9.1).

// nginx 의 `location ^~ /collab/` 은 URI 를 그대로 넘긴다(proxy_pass 뒤에 경로가 없다).
// 직접 붙는 경우(호스트 루프백)까지 감안해 몇 가지를 함께 받는다.
const WS_PATHS = new Set(['/collab', '/collab/', '/collab/ws']);

// WS 프로토콜 레벨 ping 주기. nginx 의 proxy_read_timeout(3600s) 안쪽에서 연결을 살려 둔다.
const HEARTBEAT_INTERVAL_MS = 30_000;

const startedAt = Date.now();
let connectionCount = 0;

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

function sendErr(ws: WsSocket, code: string, message: string): void {
  ws.send(JSON.stringify({ type: 'err', code, message }));
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

// --- healthz (compose healthcheck / 운영 확인용, 외부에는 노출되지 않는다) -----------------
const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        status: 'ok',
        uptime_s: Math.floor((Date.now() - startedAt) / 1000),
        ws_connections: connectionCount,
        open_docs: 0,
        last_flush_at: null,
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
  const client = ws as CollabSocket;
  const session = client.session;
  if (!session) {
    // 정상 경로에서는 항상 있다. 없다면 위 업그레이드 처리 버그이므로 즉시 끊는다.
    ws.close(1011, 'session missing');
    return;
  }

  connectionCount += 1;
  client.isAlive = true;
  ws.on('pong', () => {
    client.isAlive = true;
  });

  log('info', 'collab socket connected', {
    user: session.userEmail,
    repo: session.repoId,
    can_write: session.canWrite,
    connections: connectionCount,
  });

  ws.on('message', (data: WsRawData, isBinary: boolean) => {
    if (isBinary) {
      // 1차는 JSON 텍스트 프레임만 쓴다(§9.5).
      sendErr(ws, '400', '바이너리 프레임은 지원하지 않습니다.');
      return;
    }

    const raw = rawFrameToString(data);
    const parsed = parseClientFrame(raw);
    if (!parsed.ok) {
      log('warn', 'invalid frame', { user: session.userEmail, code: parsed.code, reason: parsed.message });
      sendErr(ws, parsed.code, parsed.message);
      return;
    }

    // 방 입장·문서 open/update·flush 는 다음 단계에서 구현한다(§9.3~§9.5).
    // 지금은 확장이 원인을 알 수 있게 P0903(협업 서버 사용 불가)으로 돌려준다.
    sendErr(ws, 'P0903', `아직 구현되지 않은 메시지입니다: ${parsed.frame.type}`);
  });

  ws.on('close', (code: number) => {
    connectionCount -= 1;
    log('info', 'collab socket closed', { user: session.userEmail, repo: session.repoId, code });
  });

  ws.on('error', (error: Error) => {
    log('warn', 'collab socket error', { user: session.userEmail, reason: error.message });
  });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    const client = ws as CollabSocket;
    if (client.isAlive === false) {
      client.terminate();
      continue;
    }
    client.isAlive = false;
    client.ping();
  }
}, HEARTBEAT_INTERVAL_MS);

function shutdown(signal: string): void {
  log('info', `shutdown (${signal})`);
  clearInterval(heartbeat);
  for (const ws of wss.clients) {
    ws.close(1001, 'server shutdown');
  }
  wss.close(() => {
    server.close(() => process.exit(0));
  });
  // 정리(마지막 flush 등)가 늦어져도 컨테이너 종료를 붙잡지 않는다.
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

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