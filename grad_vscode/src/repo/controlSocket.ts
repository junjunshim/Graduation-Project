import * as vscode from 'vscode';

import { apiRequest, getServerBaseUrl } from '../api';
import {
    getCurrentBranch,
    getSession,
    getValidAccessToken,
    onDidChangeSession,
    setCurrentBranch
} from './repoSession';

/**
 * [TASK_11 §3.3, §10.2, §15.10] 제어 소켓(`/api/github/ws`) 클라이언트.
 *
 * 저장소·브랜치 단위 실시간 채널이다. presence(누가 어느 브랜치에 있는지)와 브랜치·커밋 알림만
 * 다루고, 파일 내용·커서·데코레이션은 문서 소켓(collab)이 맡는다(§9.5).
 *
 * 서버 구현과 문서가 다른 지점 두 가지를 여기에 남긴다:
 *   1. 제어 소켓에는 `joined` 프레임이 없다. 서버는 `join` 을 받으면 접속자 행을 upsert 한 뒤
 *      저장소의 모든 방에 `presence_updated` 를 보낸다(요청자 포함). 그래서 "내가 요청한 방" 의
 *      `presence_updated` 를 입장 완료(§10.2 `joining` → `active`) 신호로 쓰고, 나머지는
 *      브랜치별 접속자 표에 쌓는다(§15.5).
 *   2. 인증은 첫 프레임 전용이다(쿼리 토큰 없음). 토큰을 URL·프록시 로그에 남기지 않으려는
 *      §3.4 와 같은 이유다.
 *
 * HTTP 클라이언트와 같은 기준으로 의존성을 늘리지 않는다 — 확장 호스트(Node 22)에 전역
 * `WebSocket` 이 있어 그대로 쓴다(§3.5 의 fetch 결정과 같은 판단).
 */

/** §10.2 상태 머신 중 제어 소켓이 책임지는 구간. */
export type ControlState = 'disconnected' | 'authenticating' | 'joining' | 'joined';

/** `github_branch_presence` 행(§3.2). Editing 뷰가 이 값을 그린다(§15.5). */
export type PresenceEntry = {
    email: string;
    name?: string;
    connection_id?: string;
    connected_at?: string;
    last_seen_at?: string;
};

/** `GET /api/github/repos/presence?repo_id=` 응답 행(§3.2). 방 입장 시 저장소 전체 접속자를 한 번 받는다. */
type PresenceBranchRow = {
    name: string;
    is_default?: boolean;
    presence?: PresenceEntry[];
};

/** 서버 이벤트를 뷰가 쓰기 좋은 모양으로 옮긴 것. 원본은 `raw` 에 그대로 담는다. */
export type ControlEvent = {
    type: string;
    repoId?: number;
    branch?: string;
    /** `presence_updated` 전용 — 그 브랜치의 접속자 목록. */
    presence?: PresenceEntry[];
    /** `branch_deleted` 전용 — 삭제된 브랜치에 있던 사용자가 옮겨 갈 브랜치(§1.3-10). */
    defaultBranch?: string;
    /** `err` 전용 — SQL 이 던진 `Pxxxx` 를 그대로 옮긴 코드. */
    code?: string;
    message?: string;
    raw: Record<string, unknown>;
};

/**
 * ping 간격. nginx `proxy_read_timeout`(3600s) 안쪽이면 되지만, 끊김을 빨리 알아채려고 짧게 잡는다.
 * ping 의 PONG 이 유일한 정기 응답이라 이 타이머가 곧 생존 감시다.
 */
const PING_INTERVAL_MS = 20_000;

/** 접속자 행의 `last_seen_at` 갱신 간격(§3.3 heartbeat). */
const HEARTBEAT_INTERVAL_MS = 60_000;

/** 이 시간 동안 아무 프레임도 받지 못하면 끊긴 것으로 본다. */
const STALE_TIMEOUT_MS = 45_000;

/** 핸드셰이크가 이 시간 안에 열리지 않으면 버리고 다시 시도한다. */
const OPEN_TIMEOUT_MS = 10_000;

/** 재연결 백오프(§15.9): 1초에서 시작해 2배씩 늘리고 30초에서 멈춘다. */
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/** 토큰이 계속 거부되면 재연결을 멈춘다 — 앱에서 연결을 다시 열어야 하는 상태다. */
const MAX_AUTH_FAILURES = 3;

/** 세션(제어 소켓 입장 완료) 보유 여부 컨텍스트 키(§15.2). 뷰 커맨드의 when 조건이 쓴다. */
export const CONTEXT_HAS_REPO_SESSION = 'axis-share:hasRepoSession';

let socket: WebSocket | undefined;

/** 소켓 세대. 늦게 도착한 이전 소켓의 이벤트를 무시하는 데 쓴다(§3.3 중복 소켓 정리). */
let socketGeneration = 0;

let state: ControlState = 'disconnected';
let started = false;

/** 창(확장 호스트) 단위 접속 식별자. 같은 값으로 다시 인증하면 서버가 이전 소켓을 회수한다(§3.3). */
let clientId = '';
let connectionId = '';

/** 마지막으로 보낸 방(응답 대기 포함). `presence_updated` 가 이 값과 맞으면 입장 완료다. */
let requestedRepoId: number | undefined;
let requestedBranch: string | undefined;

/** 서버가 확인해 준 방. 여기까지 와야 다음 이동을 보낸다. */
let joinedRepoId: number | undefined;
let joinedBranch: string | undefined;

/**
 * 서버가 입장을 거부한 방(P0103 권한 없음, P0801 등록되지 않은 브랜치).
 * 같은 방을 계속 다시 보내면 "거부 → 경고 → 재시도" 가 반복되므로 기억해 두고 보내지 않는다.
 * 브랜치가 바뀌거나 새로 인증하면(AUTH_OK) 해제된다(§3.3).
 */
let blockedRepoId: number | undefined;
let blockedBranch: string | undefined;

/**
 * 브랜치별 접속자 목록(저장소 전체, §15.5). 서버가 `presence_updated` 를 저장소의 모든 방에
 * 보내므로 내 브랜치뿐 아니라 같은 저장소의 다른 브랜치 접속자도 여기에 쌓인다.
 * 0명이 된 브랜치는 지운다 — 뷰가 빈 브랜치를 그리지 않게 하려는 것이다.
 */
let presenceByBranch = new Map<string, PresenceEntry[]>();

/** 위 표가 어느 저장소의 것인지. 앱에서 다른 저장소를 열면 표를 버린다. */
let presenceRepoId: number | undefined;

let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let openTimer: ReturnType<typeof setTimeout> | undefined;
let pingTimer: ReturnType<typeof setInterval> | undefined;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;

let reconnectDelayMs = RECONNECT_MIN_MS;
let authFailures = 0;
let lastMessageAt = 0;

const stateEmitter = new vscode.EventEmitter<ControlState>();
const eventEmitter = new vscode.EventEmitter<ControlEvent>();

/** 소켓 상태 변경(입장 완료 시점 포함, §15.10). 뷰·상태 표시가 이 이벤트로 갱신한다. */
export const onDidChangeControlState = stateEmitter.event;

/** 서버 이벤트 전달. 소비자(트리·Changes 뷰)가 `type` 으로 분기한다(§15.10). */
export const onDidReceiveControlEvent = eventEmitter.event;

/** 현재 소켓 상태. `joined` 라야 그 브랜치에 편집 세션이 있다고 볼 수 있다(§10.2). */
export function getControlState(): ControlState {
    return state;
}

/** `getPresenceByBranch` 의 빈 결과. 매 호출마다 새 Map 을 만들지 않는다. */
const EMPTY_PRESENCE: ReadonlyMap<string, PresenceEntry[]> = new Map();

/**
 * 브랜치별 접속자 목록(저장소 전체, §15.5). Editing 뷰가 브랜치별로 나눠 그린다.
 * 아직 방에 들어가지 않았으면(인증 전·브랜치 이동 중) 빈 표다 — 이전 저장소·브랜치의 값을
 * 새 것으로 잘못 보여 주지 않기 위해서다.
 */
export function getPresenceByBranch(): ReadonlyMap<string, PresenceEntry[]> {
    return state === 'joined' ? presenceByBranch : EMPTY_PRESENCE;
}

/** 세션 변화에 맞춰 소켓 수명을 묶는다. `extension.ts` activate 에서 한 번 부른다. */
export function startControlSocket(context: vscode.ExtensionContext): void {
    if (started) {
        return;
    }

    started = true;
    clientId = createConnectionIdentity('axis-client');
    connectionId = createConnectionIdentity('axis-conn');

    context.subscriptions.push(onDidChangeSession(() => syncConnection()));
    context.subscriptions.push({ dispose: () => stopControlSocket() });

    // 방에 들어가기 전까지는 세션 없는 상태로 본다(§15.2).
    setContextKey(false);
    syncConnection();
}

/** 재연결 예약까지 포함해 소켓을 완전히 멈춘다(확장 종료, 세션 제거). */
export function stopControlSocket(): void {
    started = false;
    clearReconnectTimer();
    teardownSocket();
    // 거부 기록도 함께 버린다 — 다음에 시작할 때는 다시 시도해야 한다.
    blockedRepoId = undefined;
    blockedBranch = undefined;
    setState('disconnected');
}

/**
 * 세션·브랜치가 바뀔 때마다 소켓이 할 일을 정한다.
 * 세션이 사라지면 정리하고, 없으면 열고, 열려 있으면 방을 맞춘다.
 */
function syncConnection(): void {
    if (!started) {
        return;
    }

    const session = getSession();
    if (!session || !getCurrentBranch()) {
        clearReconnectTimer();
        teardownSocket();
        setState('disconnected');
        return;
    }

    // 앱에서 다른 저장소를 열었으면 이전 저장소의 접속자 표를 버린다.
    if (presenceRepoId !== session.repoId) {
        presenceByBranch.clear();
        presenceRepoId = session.repoId;
    }

    if (!socket) {
        // 인증 중이면 connect 가 이미 소켓을 만드는 중이다(중복 연결·백오프 우회 방지).
        if (state !== 'authenticating') {
            connect();
        }
        return;
    }

    // 소켓이 열려 있으면 방을 맞춘다. `joining` 에서도 보내야 한다 —
    // 서버가 입장을 거부하면 응답 대신 `err` 가 오므로 그 상태에 갇히기 때문이다(2026-10-08 수정).
    if (state !== 'authenticating') {
        syncRoom();
    }
}

/** 소켓을 새로 연다. 이전 소켓과 타이머는 먼저 정리한다. */
function connect(): void {
    clearReconnectTimer();
    teardownSocket();

    const url = webSocketUrl();
    if (!url) {
        log('제어 소켓 주소를 만들지 못했습니다. axis-share.serverUrl 설정을 확인해 주세요.');
        return;
    }

    setState('authenticating');

    const generation = ++socketGeneration;
    let opening: WebSocket;
    try {
        opening = new WebSocket(url);
    } catch (error) {
        log(`제어 소켓을 열지 못했습니다: ${describe(error)}`);
        scheduleReconnect();
        return;
    }

    socket = opening;
    lastMessageAt = Date.now();

    openTimer = setTimeout(() => {
        if (generation !== socketGeneration) {
            return;
        }

        log('제어 소켓 핸드셰이크가 끝나지 않아 다시 연결합니다.');
        dropSocketAndReconnect();
    }, OPEN_TIMEOUT_MS);

    opening.onopen = () => {
        if (generation !== socketGeneration) {
            return;
        }

        clearOpenTimer();
        lastMessageAt = Date.now();
        startPingWatchdog();
        void sendAuthFrame(generation);
    };

    opening.onmessage = (event: MessageEvent) => {
        if (generation !== socketGeneration) {
            return;
        }

        lastMessageAt = Date.now();
        handleFrame(String(event.data));
    };

    // 오류 뒤에는 항상 close 가 따라온다. 재연결은 close 에서 한 번만 예약한다.
    opening.onerror = () => {
        if (generation === socketGeneration) {
            log('제어 소켓에서 오류가 보고되었습니다.');
        }
    };

    opening.onclose = () => {
        if (generation !== socketGeneration) {
            return;
        }

        log('제어 소켓 연결이 끊어졌습니다. 다시 연결합니다.');
        dropSocketAndReconnect();
    };
}

/** 첫 프레임 인증(§3.3). 토큰이 만료 임박이면 `repoSession` 이 먼저 갱신해 준다. */
async function sendAuthFrame(generation: number): Promise<void> {
    const token = await getValidAccessToken();
    if (generation !== socketGeneration) {
        return;
    }

    if (!token) {
        // 토큰이 없으면 인증할 수 없다. 세션 변화가 오면 다시 시도된다.
        log('확장 토큰이 없어 제어 소켓 인증을 건너뜁니다.');
        teardownSocket();
        setState('disconnected');
        return;
    }

    send({ type: 'auth', token, client_id: clientId, connection_id: connectionId });
}

/** 서버 프레임 하나를 처리한다(§3.3 서버 → 클라이언트 표). */
function handleFrame(text: string): void {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return;
    }

    if (!isRecord(parsed)) {
        return;
    }

    const type = asString(parsed.type) ?? '';
    switch (type) {
        case 'AUTH_OK':
            // 인증이 끝났다. 이제 방에 들어간다(§10.2 joining).
            authFailures = 0;
            reconnectDelayMs = RECONNECT_MIN_MS;
            // 새 인증은 새 시도다 — 거부됐던 방도 한 번은 다시 보내 본다(반복은 blocked 가 막는다).
            blockedRepoId = undefined;
            blockedBranch = undefined;
            sendJoinFrame();
            return;
        case 'AUTH_FAILED':
            handleAuthFailure();
            return;
        case 'PONG':
            return;
        case 'presence_updated':
            handlePresence(parsed);
            return;
        case 'branch_deleted':
            handleBranchDeleted(parsed);
            return;
        case 'err':
            handleServerError(parsed);
            return;
        default:
            // branch_created / commit_started / commit_finished 등은 그대로 뷰에 넘긴다.
            emitEvent(parsed, type);
            return;
    }
}

/** 방 입장. 인증 직후 한 번 보내고, 이후 이동은 `switch_branch` 다(§3.3). */
function sendJoinFrame(): void {
    const session = getSession();
    const branch = getCurrentBranch();
    if (!session || !branch) {
        return;
    }

    // 거부된 방이면 보내지 않는다. 여기서 다시 보내면 "실패 → 재연결 → 실패" 가 반복된다.
    if (blockedRepoId === session.repoId && blockedBranch === branch) {
        setState('disconnected');
        return;
    }

    if (!send({ type: 'join', repo_id: session.repoId, branch })) {
        return;
    }

    setState('joining');
    requestedRepoId = session.repoId;
    requestedBranch = branch;
}

/** 현재 브랜치와 서버가 아는 방을 맞춘다(§10.3 2단계 — `switch_branch` 전송). */
function syncRoom(): void {
    const session = getSession();
    const branch = getCurrentBranch();
    if (!session || !branch) {
        return;
    }

    // 다른 방으로 가려는 것이면 거부 기록은 의미가 없다. 지우고 새로 시도한다.
    if (blockedRepoId !== undefined && (blockedRepoId !== session.repoId || blockedBranch !== branch)) {
        blockedRepoId = undefined;
        blockedBranch = undefined;
    }

    // 서버가 확인해 준 방에 이미 들어가 있을 때만 보낼 것이 없다.
    // `joined` 가 아닌데 방이 같다면(입장 거부·끊김으로 풀린 경우) 다시 확인받아야 한다 —
    // 그래야 이전 브랜치로 돌아왔을 때 접속자 목록이 되살아난다.
    if (state === 'joined' && joinedRepoId === session.repoId && joinedBranch === branch) {
        return;
    }

    if (requestedRepoId === session.repoId && requestedBranch === branch) {
        // 같은 이동을 이미 보내고 응답을 기다리는 중이다.
        return;
    }

    if (blockedRepoId === session.repoId && blockedBranch === branch) {
        // 서버가 거부한 방이다. 사용자가 브랜치를 바꿀 때까지 다시 보내지 않는다.
        return;
    }

    if (!send({ type: 'switch_branch', repo_id: session.repoId, from: joinedBranch ?? branch, to: branch })) {
        return;
    }

    setState('joining');
    requestedRepoId = session.repoId;
    requestedBranch = branch;
}

/**
 * 접속자 목록 갱신. 내가 요청한 방의 응답이면 입장 완료로 본다 —
 * 서버가 이 소켓에는 `joined` 를 보내지 않기 때문이다(파일 머리말 참고).
 */
function handlePresence(payload: Record<string, unknown>): void {
    const repoId = asNumber(payload.repo_id);
    const branch = asString(payload.branch);
    const list = asPresence(payload.presence);

    // 저장소 전체 접속자 표를 먼저 갱신한다(내 브랜치 + 다른 브랜치, §15.5).
    // 서버가 저장소의 모든 방에 보내므로 다른 브랜치 인원도 여기서 따라온다.
    if (repoId !== undefined && branch && repoId === getSession()?.repoId) {
        if (list.length > 0) {
            presenceByBranch.set(branch, list);
        } else {
            presenceByBranch.delete(branch);
        }
    }

    if (repoId !== undefined && branch && repoId === requestedRepoId && branch === requestedBranch) {
        const entering = state !== 'joined' || joinedBranch !== branch;
        joinedRepoId = repoId;
        joinedBranch = branch;
        setState('joined');
        startHeartbeat();
        if (entering) {
            log(`제어 소켓 입장 완료: ${getSession()?.userEmail ?? ''} → ${branch} (접속자 ${list.length}명)`);
            // 내가 들어오기 전부터 다른 브랜치에 있던 접속자는 이벤트가 오지 않았다.
            // 저장소 전체 접속자를 한 번 받아 표를 채운다(§3.2 GET /repos/presence).
            void seedPresenceSnapshot(repoId);
        }
        emitEvent(payload, 'presence_updated');

        // 응답을 기다리는 사이에 사용자가 브랜치를 또 옮겼을 수 있다.
        syncRoom();
        return;
    }

    emitEvent(payload, 'presence_updated');
}

/**
 * 저장소 전체 접속자를 한 번 받아 접속자 표를 채운다(§3.2 `GET /repos/presence`, §15.5).
 * 소켓은 앞으로의 변화만 알려 주므로, 입장 시점에 이미 있던 다른 브랜치 접속자는 이 조회로 채운다.
 * 실패해도 치명적이지 않다 — 그 브랜치의 다음 `presence_updated` 가 다시 채운다.
 */
async function seedPresenceSnapshot(repoId: number): Promise<void> {
    try {
        const rows = await apiRequest<PresenceBranchRow[]>(`/github/repos/presence?repo_id=${repoId}`);
        // 받는 사이에 저장소가 바뀌었거나 방을 떠났으면 버린다.
        if (getSession()?.repoId !== repoId || state !== 'joined') {
            return;
        }

        for (const row of rows) {
            const list = asPresence(row.presence);
            if (!row.name) {
                continue;
            }
            if (list.length > 0) {
                presenceByBranch.set(row.name, list);
            } else {
                presenceByBranch.delete(row.name);
            }
        }
        presenceRepoId = repoId;
        emitEvent({ type: 'presence_updated' }, 'presence_updated');
    } catch (error) {
        log(`저장소 전체 접속자 목록을 받지 못했습니다: ${describe(error)}`);
    }
}

/** 브랜치 삭제 전파(§1.3-10). 삭제된 브랜치에 있던 사용자는 기본 브랜치로 옮긴다. */
function handleBranchDeleted(payload: Record<string, unknown>): void {
    const deleted = asString(payload.branch);
    const fallback = asString(payload.default_branch) ?? getSession()?.defaultBranch;

    if (deleted && deleted === getCurrentBranch() && fallback) {
        // setCurrentBranch 가 세션 이벤트를 쏘고, 그 이벤트가 switch_branch 로 이어진다.
        setCurrentBranch(fallback);
        void vscode.window.showWarningMessage(
            `Axis Share: 브랜치 '${deleted}' 가 삭제되어 '${fallback}' 로 이동했습니다.`
        );
    }

    emitEvent(payload, 'branch_deleted');
}

/** 서버 오류(`err`). SQL 이 던진 코드를 그대로 옮겨 온다(§3.3 추가분). */
function handleServerError(payload: Record<string, unknown>): void {
    const code = asString(payload.code);
    const message = asString(payload.message) ?? '요청을 처리하지 못했습니다.';

    // 입장·방 이동이 거부된 경우(P0103 권한 없음, P0801 없는 브랜치)는 알려 줘야 한다.
    // 그냥 두면 화면은 새 브랜치인데 서버 방은 이전 브랜치인 어긋난 상태가 조용히 남는다.
    const roomFailure = code === 'P0103' || code === 'P0801' || code === 'P0401';
    if (state !== 'joined' || roomFailure) {
        void vscode.window.showWarningMessage(`Axis Share: ${message}${code ? ` (${code})` : ''}`);
    }

    if (roomFailure) {
        // 서버가 방을 거부했다(P0103 권한 없음, P0801 등록되지 않은 브랜치).
        // 여기서 상태를 풀지 않으면 "응답 대기(joining)" 에 갇힌다 — 그 상태에서는
        // syncRoom 이 요청을 보내지 않아, 브랜치를 되돌려도 접속자 목록이 돌아오지 않는다(2026-10-08 수정).
        if (requestedRepoId !== undefined && requestedBranch) {
            blockedRepoId = requestedRepoId;
            blockedBranch = requestedBranch;
        }
        requestedRepoId = undefined;
        requestedBranch = undefined;
        presenceByBranch.clear();
        setState('disconnected');
        // 거부된 방이 아닌 곳(이전 브랜치 등)을 가리키고 있으면 곧바로 다시 맞춘다.
        syncConnection();
    }

    emitEvent(payload, 'err');
}

/** 토큰이 거부됐다(만료·회전 실패). `repoSession` 이 갱신을 시도하므로 몇 번까지는 다시 붙어 본다. */
function handleAuthFailure(): void {
    authFailures += 1;
    log(`제어 소켓 인증이 거부되었습니다 (${authFailures}/${MAX_AUTH_FAILURES}).`);

    if (authFailures >= MAX_AUTH_FAILURES) {
        clearReconnectTimer();
        teardownSocket();
        setState('disconnected');
        void vscode.window.showWarningMessage(
            'Axis Share: 서버 인증이 계속 실패했습니다. 앱에서 저장소를 다시 열어 주세요.'
        );
        return;
    }

    dropSocketAndReconnect();
}

/** 프레임을 보낸다. 소켓이 없거나 닫혀 있으면 false. */
function send(payload: Record<string, unknown>): boolean {
    if (!socket || socket.readyState !== socket.OPEN) {
        return false;
    }

    try {
        socket.send(JSON.stringify(payload));
        return true;
    } catch (error) {
        log(`제어 소켓 전송 실패: ${describe(error)}`);
        return false;
    }
}

/** 현재 소켓을 버리고(재연결 예약은 하지 않는다) 방·접속자 상태를 비운다. */
function teardownSocket(): void {
    const closing = socket;
    socket = undefined;
    // 세대를 올려 두면 닫히는 중에 도착하는 이전 소켓의 이벤트는 모두 버려진다.
    socketGeneration += 1;

    if (closing) {
        try {
            closing.close();
        } catch {
            // 이미 닫힌 소켓이다.
        }
    }

    clearTimers();
    requestedRepoId = undefined;
    requestedBranch = undefined;
    joinedRepoId = undefined;
    joinedBranch = undefined;
    presenceByBranch.clear();
    presenceRepoId = undefined;
    setContextKey(false);
}

/** 현재 소켓을 버리고 백오프 뒤에 다시 붙는다. */
function dropSocketAndReconnect(): void {
    teardownSocket();
    setState('disconnected');
    scheduleReconnect();
}

/** 지수 백오프 + 지터(§15.9). 붙을 이유가 없으면(세션 없음) 예약하지 않는다. */
function scheduleReconnect(): void {
    if (!started || reconnectTimer) {
        return;
    }

    if (!getSession() || !getCurrentBranch()) {
        return;
    }

    if (authFailures >= MAX_AUTH_FAILURES) {
        return;
    }

    const delay = Math.round(reconnectDelayMs * (0.8 + Math.random() * 0.4));
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, RECONNECT_MAX_MS);

    log(`제어 소켓을 ${delay}ms 뒤에 다시 연결합니다.`);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        if (started) {
            connect();
        }
    }, delay);
}

/** ping 타이머를 켠다. ping 의 PONG 이 생존 신호라 입장 전에도 켜 둔다. */
function startPingWatchdog(): void {
    if (pingTimer) {
        return;
    }

    pingTimer = setInterval(() => {
        if (Date.now() - lastMessageAt > STALE_TIMEOUT_MS) {
            log('제어 소켓 응답이 없어 다시 연결합니다.');
            dropSocketAndReconnect();
            return;
        }

        send({ type: 'ping' });
    }, PING_INTERVAL_MS);
}

/** 접속자 행 갱신(§3.3 heartbeat). 방에 들어간 뒤에만 의미가 있다. */
function startHeartbeat(): void {
    if (heartbeatTimer) {
        return;
    }

    heartbeatTimer = setInterval(() => {
        send({ type: 'heartbeat' });
    }, HEARTBEAT_INTERVAL_MS);
}

function clearTimers(): void {
    if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = undefined;
    }

    if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
    }

    clearOpenTimer();
}

function clearOpenTimer(): void {
    if (openTimer) {
        clearTimeout(openTimer);
        openTimer = undefined;
    }
}

function clearReconnectTimer(): void {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
    }
}

/** 상태를 바꾸고 알린다. 컨텍스트 키도 여기서 한 곳만 관리한다(§15.2). */
function setState(next: ControlState): void {
    if (state === next) {
        return;
    }

    state = next;
    setContextKey(next === 'joined');
    stateEmitter.fire(next);
}

/** 컨텍스트 키. 방에 들어가야 true 다 — 뷰 안 커맨드의 when 조건이 이 값을 쓴다(§15.2). */
function setContextKey(active: boolean): void {
    void vscode.commands.executeCommand('setContext', CONTEXT_HAS_REPO_SESSION, active);
}

function emitEvent(payload: Record<string, unknown>, type: string): void {
    eventEmitter.fire({
        type,
        repoId: asNumber(payload.repo_id),
        branch: asString(payload.branch),
        presence: payload.presence === undefined ? undefined : asPresence(payload.presence),
        defaultBranch: asString(payload.default_branch),
        code: asString(payload.code),
        message: asString(payload.message),
        raw: payload
    });
}

/** `https://host/api` → `wss://host/api/github/ws`. 설정을 바꾸면 그대로 따라간다. */
function webSocketUrl(): string | undefined {
    try {
        const url = new URL(getServerBaseUrl());
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        return `${url.toString().replace(/\/+$/, '')}/github/ws`;
    } catch {
        return undefined;
    }
}

/**
 * 창(확장 호스트)마다 하나씩 만드는 접속 식별자.
 * 같은 `client_id` 로 다시 인증하면 서버가 이전 소켓을 회수하고, 같은 `connection_id` 면
 * 접속자 행을 승계한다(§3.3) — 재접속이 중복 접속자로 남지 않게 하려는 것이다.
 */
function createConnectionIdentity(prefix: string): string {
    const random = Math.random().toString(36).slice(2, 10);
    return `${prefix}-${Date.now().toString(36)}-${random}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asPresence(value: unknown): PresenceEntry[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.filter(isRecord).map((row) => ({
        email: typeof row.email === 'string' ? row.email : '',
        name: typeof row.name === 'string' ? row.name : undefined,
        connection_id: typeof row.connection_id === 'string' ? row.connection_id : undefined,
        connected_at: typeof row.connected_at === 'string' ? row.connected_at : undefined,
        last_seen_at: typeof row.last_seen_at === 'string' ? row.last_seen_at : undefined
    }));
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** 확장 호스트 로그. 출력 채널을 붙이게 되면 여기만 바꾸면 된다. */
function log(message: string): void {
    console.log(`[axis-share/control] ${message}`);
}
