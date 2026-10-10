import * as vscode from 'vscode';
import * as Y from 'yjs';

import { ApiError, apiRequest, getServerBaseUrl } from '../api';
import { getControlState, onDidChangeControlState } from './controlSocket';
import { clearSession, getCurrentBranch, getSession, onDidChangeSession } from './repoSession';
import { branchSlug } from './repoTreeProvider';
import { diffRange, normalizeEol, toRawOffset } from './text';

/**
 * [TASK_11 §12.4 / §12.7] 문서 소켓(`/collab/`) 클라이언트 — 파일 열기와 실시간 텍스트 동기화.
 *
 * 파일 내용의 출처는 하나뿐이다 — 항상 collab 의 `open` / `opened` 다(§12.4). 앱의 "저장소 자세히 보기"
 * 용도인 `GET /api/github/repos/file` 은 편집 경로에서 쓰지 않는다(진실을 둘로 만들지 않는다).
 *
 * 협업 서버는 두 겹으로 접속을 통제한다(§9.2).
 *   1. 확장이 C++ `POST /api/collab/tickets` 로 1회용 티켓(TTL 60초)을 받는다.
 *   2. 그 티켓을 쿼리로 붙인 `wss://<host>/collab/?ticket=…` 만 collab 이 받아 준다.
 * 그래서 REST 클라이언트(api.ts)의 토큰 인터셉터를 그대로 쓰고, 소켓은 티켓으로만 인증한다.
 *
 * 텍스트 병합은 Yjs 가 한다. 이 모듈은 값을 해석하지 않고 그대로 옮기기만 한다(§9.1).
 *
 * 끊기면 편집을 잠그고, 다시 붙으면 열려 있던 파일을 서버 내용으로 통째로 다시 받는다(§12.10).
 */

/** Yjs 공유 텍스트 타입 이름. collab 과 같은 값이어야 한다(§8.5). */
const TEXT_TYPE = 'codetext';

/** `join` 을 보내고 입장 완료(`joined`)를 기다리는 상한. */
const JOIN_TIMEOUT_MS = 10_000;

/** `open` 을 보내고 `opened` 를 기다리는 상한. */
const OPEN_TIMEOUT_MS = 15_000;

/** 로컬 사본 디스크 쓰기 디바운스(§10.1). 타이핑마다 파일을 쓰지 않는다. */
const SAVE_DEBOUNCE_MS = 1_000;

/** 재연결 백오프(§12.10). 제어 소켓과 같은 규칙 — 1초에서 2배씩 늘려 30초에서 멈춘다(±20% 지터). */
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

/** 끊긴 뒤 편집을 잠그기까지의 유예(§12.10). 이 안에 다시 붙으면 잠그지 않는다. */
const LOCK_GRACE_MS = 3_000;

/** 문서 소켓 상태(§10.2 상태 머신 중 이 모듈이 책임지는 구간). */
export type DocState = 'disconnected' | 'joining' | 'active';

/**
 * 편집 연결 상태(§12.10) — 상태 표시줄(`connectionStatus.ts`)이 이 값으로 배지를 그린다.
 * `idle` 은 "붙을 방이 없거나 스스로 접은 상태"라 알릴 것이 없고, `reconnecting`·`locked`·`readonly` 는 사고다.
 */
export type DocConnection = 'idle' | 'joining' | 'active' | 'reconnecting' | 'locked' | 'readonly';

/** 서버가 확인해 준 `opened` 프레임에서 이 모듈이 쓰는 필드만 추린 것. */
type OpenedFrame = {
    path: string;
    /** 클라이언트 Yjs replica 를 만드는 초기 상태(base64). */
    state: string;
    /** 원본 파일의 줄바꿈. Yjs 텍스트는 항상 LF 이고, 로컬 사본을 쓸 때만 되돌린다. */
    eol: 'lf' | 'crlf';
    canWrite: boolean;
    /** 서버에 저장된 doc 과 worktree 파일이 어긋난 채 열렸다(§9.3). */
    mismatch: boolean;
    /** 이 파일을 함께 보고 있는 사람들(§9.5). 열 때 한 번 받는다. */
    watchers: FileWatcher[];
};

/** 지금 열려 있는 파일 하나. Y.Doc 과 그 로컬 사본을 묶는다. */
type Watching = {
    path: string;
    doc: Y.Doc;
    text: Y.Text;
    /** `globalStorage/repo-<id>/branch-<slug>/<path>` 의 실제 파일 URI(§10.1). */
    uri: vscode.Uri;
    /** 원본 파일의 줄바꿈. Yjs 텍스트는 LF 고정이고, 로컬 사본을 쓸 때만 되돌린다(§12.4). */
    eol: 'lf' | 'crlf';
    canWrite: boolean;
    /** 서버의 방에 붙어 있는가. 끊기면 false 가 되고 편집을 보내지 않는다. */
    attached: boolean;
    /** 저장된 편집 내용과 파일이 달라 **파일 내용으로** 열렸다(§9.3). 상태 표시줄 배지가 읽는다. */
    mismatch: boolean;
    /** 원격 반영이 만든 변경 이벤트를 에코로 보기 위한 표시(§12.7). */
    applyingRemote: number;
    /** 원격 반영을 순서대로 처리하는 큐(§12.7). */
    queue: Promise<void>;
    saveTimer: ReturnType<typeof setTimeout> | undefined;
};

/** 열려 있는 파일의 읽기용 뷰. 커서 모듈이 Y.Text 로 상대좌표를 만들고 해석한다(§12.8). */
export type OpenDoc = {
    readonly path: string;
    readonly uri: vscode.Uri;
    readonly doc: Y.Doc;
    readonly text: Y.Text;
    readonly canWrite: boolean;
    readonly attached: boolean;
    /** 저장된 편집 내용과 파일이 달라 **파일 내용으로** 열렸다(§9.3). */
    readonly mismatch: boolean;
};

/** 서버가 중계한 원격 커서 프레임(§9.5). 상대좌표는 해석하지 않고 그대로 넘긴다(§8.10). */
export type RemoteCursorFrame = {
    path: string;
    userEmail: string;
    userName?: string;
    startRel: unknown;
    endRel: unknown;
    activeRel: unknown;
};

/** 다른 사용자가 파일에서 나갔다(§9.5). 그 사용자의 커서를 지우는 유일한 신호다. */
export type FilePeerLeave = {
    path: string;
    userEmail: string;
};

/** 파일 1개를 보고 있는 사람(§9.5). 서버가 `opened.watchers`·`peer_join` 으로 알려 준다. */
export type FileWatcher = {
    email: string;
    name?: string;
};

/**
 * 파일 1개와 그것을 보고 있는 사람들(§15.5 Editing 뷰 사람 → 파일 단계).
 * 문서 소켓이 아는 것만 담는다 — 이 브랜치에서 내가 연 파일과, 그 파일을 함께 보는 사람뿐이다.
 */
export type OpenFilePresence = {
    path: string;
    watchers: readonly FileWatcher[];
};

/** 서버가 중계한 리뷰 데코레이션 1건(§9.5). 좌표는 상대좌표라 해석하지 않고 그대로 넘긴다(§8.10). */
export type RemoteDecoration = {
    path: string;
    id: string;
    decoType?: string;
    memo?: string;
    /** 표시용 줄 번호 스냅샷(0-based). 열린 doc 이 있으면 상대 좌표로 다시 계산한 값이 우선이다. */
    line?: number;
    startRel?: unknown;
    endRel?: unknown;
    userEmail: string;
    userName?: string;
    createdAt?: string;
};

/** 다른 사용자가 데코레이션을 지웠다(§9.5). */
export type RemoteDecorationDelete = {
    path: string;
    id: string;
};

/** 방에 들어가자마자 받는 브랜치 리뷰 인덱스(§15.6). 사이드바가 파일을 열지 않고 목록을 그린다. */
export type ReviewIndexFrame = {
    branch: string;
    reviews: readonly RemoteDecoration[];
};

let extensionContext: vscode.ExtensionContext | undefined;
let started = false;

let socket: WebSocket | undefined;

/** 소켓 세대. 늦게 도착한 이전 소켓의 이벤트를 무시하는 데 쓴다(§3.3 중복 소켓 정리). */
let socketGeneration = 0;

let state: DocState = 'disconnected';

/** 서버가 확인해 준 방. 여기까지 와야 파일을 열 수 있다. */
let joinedRepoId: number | undefined;
let joinedBranch: string | undefined;

/** 진행 중인 입장 작업과 그 목표 방(`repoId|branch`). 같은 목표면 하나로 합친다. */
let joinTarget: string | undefined;
let joinTask: Promise<void> | undefined;

let joinWaiter: { resolve: () => void; reject: (error: Error) => void } | undefined;
let joinTimer: ReturnType<typeof setTimeout> | undefined;

/** 다시 붙을 방과 백오프(§12.10). 끊긴 시점의 방을 기억한다 — 그 사이 브랜치가 바뀌면 버린다. */
let reconnectTarget: { repoId: number; branch: string } | undefined;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectDelayMs = RECONNECT_MIN_MS;

/** 편집 잠금 유예 타이머와 잠금 여부(§12.10). */
let lockTimer: ReturnType<typeof setTimeout> | undefined;
let docsLocked = false;

/** 편집 권한 회수 통보(`perm`)로 읽기 전용이 되었는가(§12.9). 연결 잠금(`docsLocked`)과 별개다. */
let writeRevoked = false;

/**
 * 제어 소켓이 방에 들어가 있는가(§12.10). 아니면 편집을 잠근다.
 *
 * presence(접속자 행)는 제어 소켓이 방에 들어가야 생기고, §12.9 의 권한 통보는 그 행을 기준으로
 * 대상을 고른다. 그래서 제어 소켓이 끊긴 동안에는 `perm`(쓰기 회수)도 강제 이탈도 이 세션에
 * 닿지 않는다 — heartbeat 안전망도 끊긴 소켓에는 오지 않는다. 그 틈에 권한을 잃은 사용자가
 * 편집하면 서버는 그를 편집자로 모른 채 공유 doc 에 내용이 쌓인다.
 */
let controlJoined = false;

/** 편집 연결 상태(§12.10). 상태 표시줄이 구독한다. */
let docConnection: DocConnection = 'idle';

/** 경로별 `opened` 대기자. */
const openWaiters = new Map<
    string,
    { resolve: (frame: OpenedFrame) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
>();

/** 지금 열려 있는 파일들. 경로가 키다(§12.4 — 같은 파일을 두 번 열지 않는다). */
const watching = new Map<string, Watching>();

/**
 * 이 브랜치에서 열려 있는 파일(경로) → 그 파일을 보는 사람(§15.5 Editing 뷰 사람 → 파일 단계).
 * 문서 소켓이 아는 것만 담는다 — `opened.watchers`(열 때)와 `peer_join`/`peer_leave`(그 뒤)뿐이다(§9.5).
 * **키는 항상 `watching` 의 부분집합이다** — 감시를 끝낸 파일은 여기에도 남지 않는다.
 */
const openFileWatchers = new Map<string, FileWatcher[]>();

/** 같은 오류를 반복해 알리지 않는다(§9.8). */
const warnedCodes = new Set<string>();

const openDocsEmitter = new vscode.EventEmitter<void>();
const cursorEmitter = new vscode.EventEmitter<RemoteCursorFrame>();
const peerLeaveEmitter = new vscode.EventEmitter<FilePeerLeave>();
const decorationEmitter = new vscode.EventEmitter<RemoteDecoration>();
const decorationDeleteEmitter = new vscode.EventEmitter<RemoteDecorationDelete>();
const reviewIndexEmitter = new vscode.EventEmitter<ReviewIndexFrame>();
const docConnectionEmitter = new vscode.EventEmitter<DocConnection>();
const filePresenceEmitter = new vscode.EventEmitter<void>();

/** 열려 있는 문서 목록이 바뀌었다(열림·닫힘·브랜치 전환). 커서 렌더러가 이 이벤트로 다시 그린다. */
export const onDidChangeOpenDocs = openDocsEmitter.event;

/** 원격 커서 수신(§12.8). 커서 모듈이 상대좌표를 해석해 화면에 그린다. */
export const onDidReceiveCursor = cursorEmitter.event;

/** 파일 참여자 이탈(§9.5). 서버는 커서 제거를 따로 알리지 않으므로 커서 모듈이 이 신호로 지운다. */
export const onDidReceivePeerLeave = peerLeaveEmitter.event;

/** 리뷰 데코레이션 추가·변경(§9.5). 데코 모듈이 인덱스에 반영하고 에디터에 그린다(§15.6). */
export const onDidReceiveDecoration = decorationEmitter.event;

/** 리뷰 데코레이션 삭제(§15.6 — 삭제는 누구나 가능하다). */
export const onDidReceiveDecorationDelete = decorationDeleteEmitter.event;

/** 브랜치 리뷰 인덱스 스냅샷(§15.6). 방에 들어갈 때마다 한 번 오므로 인덱스를 그대로 갈아 끼우면 된다. */
export const onDidReceiveReviewIndex = reviewIndexEmitter.event;

/** 편집 연결 상태 변경(§12.10). 상태 표시줄이 이 이벤트로 배지를 다시 그린다. */
export const onDidChangeDocConnection = docConnectionEmitter.event;

/** 파일별 참여자 변경(§15.5). Editing 뷰가 이 이벤트로 사람 → 파일 단계를 다시 그린다. */
export const onDidChangeFilePresence = filePresenceEmitter.event;

// ---------------------------------------------------------------------------
// 수명주기
// ---------------------------------------------------------------------------

/** 세션·브랜치 변화를 구독해 소켓 수명을 묶는다. `extension.ts` activate 에서 한 번 부른다. */
export function startDocSocket(context: vscode.ExtensionContext): void {
    if (started) {
        return;
    }

    started = true;
    extensionContext = context;
    controlJoined = getControlState() === 'joined';
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => onDocumentChanged(event)),
        vscode.workspace.onDidCloseTextDocument((document) => onDocumentClosed(document)),
        vscode.window.tabGroups.onDidChangeTabs((event) => onTabsClosed(event)),
        vscode.window.onDidChangeActiveTextEditor((editor) => onActiveEditorChanged(editor)),
        onDidChangeSession(() => onSessionChanged()),
        onDidChangeControlState((next) => applyControlGate(next === 'joined')),
        { dispose: () => stopDocSocket() }
    );
}

/** 열려 있던 문서를 접고 소켓을 정리한다(확장 종료). */
export function stopDocSocket(): void {
    started = false;
    void retireAll();
    extensionContext = undefined;
}

/** 세션·브랜치가 바뀌면 이전 브랜치의 편집 세션을 접는다(§10.3). */
function onSessionChanged(): void {
    if (!started) {
        return;
    }

    const session = getSession();
    const branch = getCurrentBranch();
    if (session && branch && session.repoId === joinedRepoId && branch === joinedBranch) {
        return; // 같은 방이다 — 그대로 둔다.
    }

    if (state === 'disconnected' && watching.size === 0) {
        return; // 붙은 적이 없다(핸드오프 직후 등).
    }

    void retireAll();
}

/** 열려 있던 탭을 접고 소켓을 버린다. 다음 파일 열기에서 새 방으로 다시 붙는다. */
async function retireAll(): Promise<void> {
    const uris = [...watching.values()].map((entry) => entry.uri);
    cancelReconnect();
    unlockEditors(false);
    watching.clear();
    emitOpenDocsChange();
    clearFileWatchers();

    await teardown();

    for (const uri of uris) {
        await closeTab(uri);
    }
}

// ---------------------------------------------------------------------------
// 파일 열기
// ---------------------------------------------------------------------------

/** 트리 항목(RepoTreeEntry)을 그대로 받아 파일을 연다 — 뷰의 클릭·컨텍스트 메뉴가 이 인자를 넘긴다. */
export function openRepoFile(entry: unknown): Promise<void> {
    const path = isRecord(entry) && typeof entry.path === 'string' ? entry.path : undefined;
    if (path === undefined) {
        void vscode.window.showWarningMessage('Axis Share: 열 파일을 선택해 주세요.');
        return Promise.resolve();
    }

    return openFile(path);
}

/** 파일 하나를 연다. 이미 열려 있으면 탭만 앞으로 가져온다(§12.4). */
async function openFile(path: string): Promise<void> {
    const session = getSession();
    const branch = getCurrentBranch();
    if (!session || !branch) {
        void vscode.window.showWarningMessage('Axis Share: 앱에서 저장소를 연결한 뒤 파일을 열 수 있습니다.');
        return;
    }

    const existing = watching.get(path);
    if (existing?.attached) {
        await reveal(existing.uri);
        return;
    }

    if (existing) {
        // 끊긴 사본이다 — 탭은 두고 서버 내용으로 다시 채운다(§12.10 재동기화).
        try {
            await ensureJoined(session.repoId, branch);
            await applyServerFrame(existing, await requestOpen(path));
            await reveal(existing.uri);
        } catch (error) {
            const message = describe(error);
            log(`파일을 다시 열지 못했습니다(${path}): ${message}`);
            void vscode.window.showWarningMessage(`Axis Share: ${message}`);
        }
        return;
    }

    try {
        await ensureJoined(session.repoId, branch);
        const opened = await requestOpen(path);
        await materialize(session.repoId, branch, opened);
    } catch (error) {
        const message = describe(error);
        log(`파일을 열지 못했습니다(${path}): ${message}`);
        void vscode.window.showWarningMessage(`Axis Share: ${message}`);
    }
}

/**
 * 파일의 편집 세션만 물린다 — 에디터 탭은 열지 않는다(§15.15 diff). 이미 물려 있으면 그대로 둔다.
 * diff 의 오른쪽이 이 로컬 사본이고, 세션이 붙어 있어야 다른 사용자의 편집이 그대로 반영된다.
 */
export async function ensureDocSession(path: string): Promise<vscode.Uri | undefined> {
    const session = getSession();
    const branch = getCurrentBranch();
    if (!session || !branch) {
        void vscode.window.showWarningMessage('Axis Share: 앱에서 저장소를 연결한 뒤 파일을 열 수 있습니다.');
        return undefined;
    }

    const existing = watching.get(path);
    if (existing?.attached) {
        return existing.uri;
    }

    if (existing) {
        // 끊긴 사본이다 — 탭을 열지 않고 서버 내용으로 다시 채운다(§12.10 재동기화).
        try {
            await ensureJoined(session.repoId, branch);
            await applyServerFrame(existing, await requestOpen(path));
            return existing.uri;
        } catch (error) {
            log(`파일 세션을 다시 물리지 못했습니다(${path}): ${describe(error)}`);
            return undefined;
        }
    }

    try {
        await ensureJoined(session.repoId, branch);
        const opened = await requestOpen(path);
        return await materialize(session.repoId, branch, opened, { reveal: false });
    } catch (error) {
        const message = describe(error);
        log(`파일 세션을 물리지 못했습니다(${path}): ${message}`);
        return undefined;
    }
}

/**
 * `opened` 를 받아 Y.Doc 을 만들고 로컬 사본을 쓴다(§12.4 열기 순서 5~6).
 * `reveal` 이 false 면 에디터 탭을 열지 않는다 — diff(§15.15)의 오른쪽은 탭이 필요 없다.
 */
async function materialize(
    repoId: number,
    branch: string,
    opened: OpenedFrame,
    options: { reveal?: boolean } = {}
): Promise<vscode.Uri> {
    const uri = localCopyUri(repoId, branch, opened.path);

    const doc = new Y.Doc();
    Y.applyUpdate(doc, b64ToBytes(opened.state), 'remote');
    const text = doc.getText(TEXT_TYPE);

    const entry: Watching = {
        path: opened.path,
        doc,
        text,
        uri,
        eol: opened.eol,
        canWrite: opened.canWrite,
        attached: true,
        mismatch: opened.mismatch,
        applyingRemote: 0,
        queue: Promise.resolve(),
        saveTimer: undefined
    };
    watching.set(opened.path, entry);
    emitOpenDocsChange();
    setFileWatchers(opened.path, opened.watchers);

    await writeLocalCopy(entry);

    // 같은 경로가 이미 에디터에 열려 있으면(이전 세션 등) 버퍼도 서버 내용으로 맞춘다.
    if (findDocument(uri)) {
        await pushTextToEditor(entry);
    }

    if (options.reveal !== false) {
        await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(uri, { preview: false });
    }

    if (opened.mismatch) {
        void vscode.window.showWarningMessage(
            `Axis Share: ${opened.path} 는 저장된 편집 내용과 파일이 달라, 파일 내용을 기준으로 열었습니다.`
        );
    }

    if (!opened.canWrite) {
        void vscode.window.showWarningMessage(
            `Axis Share: ${opened.path} 는 읽기 전용 권한입니다. 편집 내용은 서버로 전송되지 않습니다.`
        );
    }

    return uri;
}

/**
 * 서버 권위 상태(`opened`)로 이 파일의 로컬 doc·버퍼를 통째로 갈아 끼운다(§12.10 재동기화).
 * 로컬 replica 를 병합하지 않는다 — 끊긴 동안의 로컬 변경은 버리고 서버 내용만 따른다.
 */
async function applyServerFrame(entry: Watching, opened: OpenedFrame): Promise<void> {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, b64ToBytes(opened.state), 'remote');

    const previous = entry.doc;
    entry.doc = doc;
    entry.text = doc.getText(TEXT_TYPE);
    entry.eol = opened.eol;
    entry.canWrite = opened.canWrite;
    entry.attached = true;
    entry.mismatch = opened.mismatch;
    emitOpenDocsChange(); // 다시 붙은 문서를 커서·데코 렌더러가 다시 그린다.
    setFileWatchers(entry.path, opened.watchers);

    // 앞선 화면 반영과 순서가 엉키지 않게 같은 큐에 태운다(§12.7).
    entry.queue = entry.queue
        .then(async () => {
            await writeLocalCopy(entry);
            await pushTextToEditor(entry);
        })
        .catch((error: unknown) => {
            log(`재동기화를 화면에 반영하지 못했습니다(${entry.path}): ${describe(error)}`);
        });
    await entry.queue;

    try {
        previous.destroy();
    } catch {
        // 이미 버린 doc 이다 — 무해하다.
    }
}

/** 로컬 사본(=캐시, §10.1)을 Yjs 텍스트로 다시 쓴다. 줄바꿈은 원본 파일 것을 따른다. */
async function writeLocalCopy(entry: Watching): Promise<void> {
    const text = entry.text.toString();
    const onDisk = entry.eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text;
    await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(entry.uri, '..'));
    await vscode.workspace.fs.writeFile(entry.uri, Buffer.from(onDisk, 'utf8'));
}

/**
 * 로컬 작업 사본 경로(§10.1): `globalStorage/repo-<id>/branch-<slug>/<path>`.
 * 문서 소켓이 만들고 에디터에 열린 문서가 이 경로를 쓴다 — 규칙은 이 한 곳에만 둔다.
 */
export function localCopyUri(repoId: number, branch: string, path: string): vscode.Uri {
    const root = extensionContext?.globalStorageUri;
    if (!root) {
        throw new Error('확장 저장 경로를 알 수 없습니다. 창을 다시 열어 주세요.');
    }

    return vscode.Uri.joinPath(root, `repo-${repoId}`, `branch-${branchSlug(branch)}`, ...path.split('/'));
}

// ---------------------------------------------------------------------------
// 편집 반영(로컬 -> Yjs)
// ---------------------------------------------------------------------------

/** 에디터가 바뀌면 Yjs 에 반영하고 증분 update 를 보낸다(§12.7 보내기). */
function onDocumentChanged(event: vscode.TextDocumentChangeEvent): void {
    const entry = entryForUri(event.document.uri);
    if (!entry) {
        return;
    }

    if (entry.applyingRemote > 0) {
        return; // 방금 우리가 반영한 원격 편집이 되돌아온 이벤트다.
    }

    if (!entry.attached) {
        return; // 끊긴 세션 — 보낼 곳이 없다. 다시 열면 새로 받는다.
    }

    if (!controlJoined) {
        // 제어 소켓이 끊긴 동안의 입력은 버린다(§12.10) — 서버는 이 사용자를 편집자로 모른다.
        // 잠금이 걸리지 못한 환경(읽기 전용 명령 미지원)에서도 내용이 새지 않도록 여기서 한 번 더
        // 막고, 버퍼를 doc 내용으로 되돌린다. 원격 편집은 계속 반영되므로 버퍼가 어긋나지 않는다.
        void pushTextToEditor(entry);
        return;
    }

    if (!entry.canWrite) {
        return; // 읽기 전용(§10.2 readonly).
    }

    // 에코 판정은 플래그가 아니라 내용으로 한다(§12.7) — 같으면 보낼 것이 없다.
    const editorText = normalizeEol(event.document.getText());
    const yjsText = entry.text.toString();
    if (editorText === yjsText) {
        return;
    }

    const edit = diffRange(yjsText, editorText);
    const stateVector = Y.encodeStateVector(entry.doc);

    entry.doc.transact(() => {
        if (edit.remove > 0) {
            entry.text.delete(edit.index, edit.remove);
        }
        if (edit.insert.length > 0) {
            entry.text.insert(edit.index, edit.insert);
        }
    }, 'local');

    send({
        type: 'update',
        path: entry.path,
        update: bytesToB64(Y.encodeStateAsUpdate(entry.doc, stateVector))
    });

    scheduleSave(entry);
}

/**
 * 서버가 되돌리기로 이 파일의 doc 을 버렸다(§12.11.1). 열어 둔 탭을 닫고 감시를 멈춘다 —
 * 파일이 사라졌으므로 더 이상 편집할 대상이 없다. 내용만 바뀌는 경우(수정 되돌리기)는
 * 일반 `update` 로 오므로 여기서 다루지 않는다.
 */
async function handleDocReset(frame: Record<string, unknown>): Promise<void> {
    const path = asString(frame.path);
    if (path === undefined) {
        return;
    }

    const entry = watching.get(path);
    if (!entry) {
        return;
    }

    watching.delete(path);
    forgetFileWatchers(path);
    if (entry.saveTimer) {
        clearTimeout(entry.saveTimer);
        entry.saveTimer = undefined;
    }
    emitOpenDocsChange();

    await closeTab(entry.uri);
    try {
        await vscode.workspace.fs.delete(entry.uri, { useTrash: false });
    } catch {
        // 로컬 사본은 언제든 다시 만들 수 있는 캐시다(§10.1) — 지우지 못해도 무해하다.
    }

    // 서버가 파일·브랜치를 지워 닫은 것이면 안내하지 않는다 — 되돌리기와 원인이 다르다(§12.5, §9.7).
    const reason = asString(frame.reason);
    if (reason !== 'tree_changed' && reason !== 'branch_deleted') {
        void vscode.window.showInformationMessage(`Axis Share: ${path} 이(가) 되돌려져 편집기에서 닫혔습니다.`);
    }
}

/** 탭이 닫히면 doc 참여를 끝낸다. 서버는 마지막 참여자가 나가면 grace 뒤 flush 한다(§12.4). */
function onDocumentClosed(document: vscode.TextDocument): void {
    const entry = entryForUri(document.uri);
    if (entry) {
        releaseWatching(entry);
    }
}

/**
 * 탭이 닫힌 순간을 직접 본다(§12.4).
 *
 * `onDidCloseTextDocument` 는 문서가 **완전히 버려질 때만** 온다 — 같은 로컬 사본을 diff(§15.15)가
 * 붙들고 있으면 오지 않는다. 그래서 탭 닫힘을 따로 보고, 그 문서를 보여 주는 탭이 하나도 남지
 * 않았으면 감시를 끝낸다. 닫힌 탭의 URI 만 검사하므로 아직 화면에 올라가지 않은 문서는 건드리지 않는다.
 */
function onTabsClosed(event: vscode.TabChangeEvent): void {
    if (event.closed.length === 0) {
        return;
    }

    const closedUris = new Set<string>();
    for (const tab of event.closed) {
        for (const uri of tabUris(tab)) {
            closedUris.add(uri);
        }
    }
    if (closedUris.size === 0) {
        return;
    }

    for (const entry of [...watching.values()]) {
        if (closedUris.has(entry.uri.toString()) && !isUriInAnyTab(entry.uri)) {
            releaseWatching(entry);
        }
    }
}

/** 이 창의 감시를 끝낸다. 마지막 참여자였으면 서버가 grace 뒤 파일로 내려쓴다(§12.4). */
function releaseWatching(entry: Watching): void {
    if (watching.delete(entry.path)) {
        emitOpenDocsChange();
    }

    // 내 탭만 닫은 것이다 — 아직 이 파일을 보는 다른 사람은 목록에 남긴다(§15.5).
    const me = getSession()?.userEmail;
    if (me !== undefined) {
        removeFileWatcher(entry.path, me);
    }

    if (entry.saveTimer) {
        clearTimeout(entry.saveTimer);
        entry.saveTimer = undefined;
    }

    if (entry.attached) {
        send({ type: 'close', path: entry.path });
    }
}

/** 탭이 들고 있는 URI(에디터 탭·diff 양쪽). 우리 문서가 아니면 빈 배열이다. */
function tabUris(tab: vscode.Tab): string[] {
    const input: unknown = tab.input;
    if (input instanceof vscode.TabInputText) {
        return [input.uri.toString()];
    }
    if (input instanceof vscode.TabInputTextDiff) {
        return [input.original.toString(), input.modified.toString()];
    }

    return [];
}

/** 이 URI 를 보여 주는 탭이 아직 하나라도 있는가. */
function isUriInAnyTab(uri: vscode.Uri): boolean {
    const key = uri.toString();
    return vscode.window.tabGroups.all.some((group) =>
        group.tabs.some((tab) => tabUris(tab).includes(key))
    );
}

// ---------------------------------------------------------------------------
// 편집 반영(Yjs -> 로컬)
// ---------------------------------------------------------------------------

/** 원격 `update` 를 doc 에 적용하고 화면 반영을 큐에 태운다(§12.7 받기). */
function applyRemoteUpdate(frame: Record<string, unknown>): void {
    const path = asString(frame.path);
    const update = asString(frame.update);
    if (path === undefined || update === undefined) {
        return;
    }

    const entry = watching.get(path);
    if (!entry) {
        return;
    }

    try {
        Y.applyUpdate(entry.doc, b64ToBytes(update), 'remote');
    } catch (error) {
        log(`원격 편집을 적용하지 못했습니다(${path}): ${describe(error)}`);
        return;
    }

    entry.queue = entry.queue.then(() => pushTextToEditor(entry)).catch((error: unknown) => {
        log(`원격 편집을 화면에 반영하지 못했습니다(${path}): ${describe(error)}`);
    });
}

/** Yjs 텍스트를 에디터 버퍼에 최소 범위로 반영한다(§12.7). */
async function pushTextToEditor(entry: Watching): Promise<void> {
    const document = findDocument(entry.uri);
    if (!document) {
        // 아무도 이 문서를 들고 있지 않다(에디터 탭도 diff 도 없다). 그래도 디스크 사본은 최신이어야
        // 한다 — 나중에 열리는 diff(§15.15)가 이 파일을 오른쪽에 쓰기 때문이다.
        await writeLocalCopy(entry);
        return;
    }

    const raw = document.getText();
    const current = normalizeEol(raw);
    const target = entry.text.toString();
    if (current === target) {
        return;
    }

    const edit = diffRange(current, target);
    const start = document.positionAt(toRawOffset(raw, edit.index));
    const end = document.positionAt(toRawOffset(raw, edit.index + edit.remove));
    // 로컬 사본의 줄바꿈을 유지한다 — 삽입한 LF 만 바꾸면 버퍼가 섞인다.
    const insert = document.eol === vscode.EndOfLine.CRLF ? edit.insert.replace(/\n/g, '\r\n') : edit.insert;

    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.replace(entry.uri, new vscode.Range(start, end), insert);

    entry.applyingRemote += 1;
    try {
        await vscode.workspace.applyEdit(workspaceEdit);
    } finally {
        entry.applyingRemote -= 1;
    }

    scheduleSave(entry);
}

/**
 * 디스크 사본은 언제든 다시 만들 수 있는 캐시다(§10.1). 잦은 쓰기를 피하려고 디바운스하고,
 * 저장해 두면 VS Code 가 "저장되지 않음" 을 띄우지 않는다.
 */
function scheduleSave(entry: Watching): void {
    if (entry.saveTimer) {
        clearTimeout(entry.saveTimer);
    }

    entry.saveTimer = setTimeout(() => {
        entry.saveTimer = undefined;
        void saveEntry(entry);
    }, SAVE_DEBOUNCE_MS);
}

async function saveEntry(entry: Watching): Promise<void> {
    const document = findDocument(entry.uri);
    if (!document?.isDirty) {
        return;
    }

    try {
        await document.save();
    } catch (error) {
        log(`로컬 사본을 저장하지 못했습니다(${entry.path}): ${describe(error)}`);
    }
}

// ---------------------------------------------------------------------------
// 접속(티켓 -> join)
// ---------------------------------------------------------------------------

/** (저장소, 브랜치) 방에 들어가 있다고 보장한다. 다른 방이면 정리하고 새로 붙는다. */
async function ensureJoined(repoId: number, branch: string): Promise<void> {
    if (state === 'active' && joinedRepoId === repoId && joinedBranch === branch) {
        return;
    }

    // 다른 방으로 옮기는 것이면 예약된 재연결은 버린다(§12.10).
    if (reconnectTarget && (reconnectTarget.repoId !== repoId || reconnectTarget.branch !== branch)) {
        cancelReconnect();
        unlockEditors(false);
    }

    const key = `${repoId}|${branch}`;
    if (joinTask) {
        if (joinTarget === key) {
            return joinTask;
        }
        await joinTask.catch(() => undefined);
    }

    const task = (async () => {
        await teardown();
        await connectAndJoin(repoId, branch);
    })();
    joinTarget = key;
    joinTask = task;

    try {
        await task;
    } finally {
        if (joinTask === task) {
            joinTask = undefined;
        }
    }
}

/** 확장 -> C++: 1회용 협업 티켓. 응답은 `{status, data:[{ticket,…}], message}` 봉투다(§3.2). */
async function fetchTicket(repoId: number): Promise<string> {
    const items = await apiRequest<Array<{ ticket?: string }>>('/collab/tickets', {
        method: 'POST',
        body: { repo_id: repoId }
    });

    const ticket = Array.isArray(items) ? items[0]?.ticket : undefined;
    if (!ticket) {
        throw new ApiError('협업 티켓 응답 형식이 올바르지 않습니다.');
    }

    return ticket;
}

/** `https://host/api` -> `wss://host/collab/?ticket=…`. 협업 소켓은 루트의 `/collab/` 이다(§13.4). */
function collabSocketUrl(ticket: string): string {
    const url = new URL(getServerBaseUrl());
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = `${url.pathname.replace(/\/api\/?$/, '')}/collab/`;
    url.search = '';
    url.hash = '';
    url.searchParams.set('ticket', ticket);
    return url.toString();
}

/** 티켓으로 소켓을 열고 `join` 을 보낸 뒤 `joined` 까지 기다린다(§9.5). */
async function connectAndJoin(repoId: number, branch: string): Promise<void> {
    const ticket = await fetchTicket(repoId);
    const generation = ++socketGeneration;

    let opening: WebSocket;
    try {
        opening = new WebSocket(collabSocketUrl(ticket));
    } catch (error) {
        throw new Error(`협업 서버에 연결하지 못했습니다: ${describe(error)}`);
    }

    socket = opening;
    setState('joining');

    const joined = new Promise<void>((resolve, reject) => {
        joinWaiter = { resolve, reject };
    });

    joinTimer = setTimeout(() => {
        if (generation === socketGeneration) {
            rejectJoin(new Error('협업 서버 입장이 시간 안에 끝나지 않았습니다.'));
        }
    }, JOIN_TIMEOUT_MS);

    opening.onopen = () => {
        if (generation !== socketGeneration) {
            return;
        }
        send({ type: 'join', repo_id: repoId, branch });
    };

    opening.onmessage = (event: MessageEvent) => {
        if (generation !== socketGeneration) {
            return;
        }
        handleFrame(String(event.data));
    };

    // 오류 뒤에는 항상 close 가 따라온다. 정리는 close 에서 한 번만 한다.
    opening.onerror = () => {
        if (generation === socketGeneration) {
            log('문서 소켓에서 오류가 보고되었습니다.');
        }
    };

    opening.onclose = () => {
        if (generation !== socketGeneration) {
            return;
        }
        handleSocketClosed();
    };

    try {
        await joined;
    } finally {
        clearJoinTimer();
    }

    joinedRepoId = repoId;
    joinedBranch = branch;
    setState('active');
}

/** `open` 을 보내고 `opened` 를 기다린다. 같은 경로를 두 번 열지 않는다(§12.4). */
function requestOpen(path: string): Promise<OpenedFrame> {
    return new Promise<OpenedFrame>((resolve, reject) => {
        const timer = setTimeout(() => {
            openWaiters.delete(path);
            reject(new Error(`파일을 여는 요청이 시간 안에 끝나지 않았습니다: ${path}`));
        }, OPEN_TIMEOUT_MS);

        openWaiters.set(path, { resolve, reject, timer });

        if (!send({ type: 'open', path })) {
            clearTimeout(timer);
            openWaiters.delete(path);
            reject(new Error('협업 서버에 연결되어 있지 않습니다.'));
        }
    });
}

// ---------------------------------------------------------------------------
// 프레임 처리
// ---------------------------------------------------------------------------

function handleFrame(text: string): void {
    let frame: Record<string, unknown>;
    try {
        const parsed: unknown = JSON.parse(text);
        if (!isRecord(parsed)) {
            return;
        }
        frame = parsed;
    } catch {
        log('문서 소켓 프레임을 해석하지 못했습니다.');
        return;
    }

    const type = asString(frame.type) ?? '';
    switch (type) {
        case 'joined':
            resolveJoin();
            return;
        case 'opened':
            resolveOpen(frame);
            return;
        case 'update':
            applyRemoteUpdate(frame);
            return;
        case 'err':
            handleServerError(frame);
            return;
        case 'cursor':
            handleCursorFrame(frame);
            return;
        case 'peer_join':
            handlePeerJoin(frame);
            return;
        case 'peer_leave':
            handlePeerLeave(frame);
            return;
        case 'deco':
            handleDecorationFrame(frame);
            return;
        case 'deco_del':
            handleDecorationDeleteFrame(frame);
            return;
        case 'reviews':
            handleReviewIndexFrame(frame);
            return;
        case 'perm':
            handlePermissionFrame(frame);
            return;
        case 'repo_closed':
            handleRepoClosed(frame);
            return;
        case 'doc_reset':
            void handleDocReset(frame);
            return;
        default:
            // `peer_join` 은 Editing 뷰의 사람 → 파일 단계(§15.5), `flushed` 는 커밋 파이프라인(§12.11)에서 쓴다.
            return;
    }
}

function resolveJoin(): void {
    const waiter = joinWaiter;
    joinWaiter = undefined;
    clearJoinTimer();
    waiter?.resolve();
}

function rejectJoin(error: Error): void {
    const waiter = joinWaiter;
    joinWaiter = undefined;
    clearJoinTimer();
    waiter?.reject(error);
}

function resolveOpen(frame: Record<string, unknown>): void {
    const path = asString(frame.path);
    if (path === undefined) {
        return;
    }

    const waiter = openWaiters.get(path);
    if (!waiter) {
        return;
    }

    openWaiters.delete(path);
    clearTimeout(waiter.timer);
    waiter.resolve({
        path,
        state: asString(frame.state) ?? '',
        eol: frame.eol === 'crlf' ? 'crlf' : 'lf',
        canWrite: frame.can_write === true,
        mismatch: frame.mismatch === true,
        watchers: parseFileWatchers(frame.watchers)
    });
}

/** `err` 프레임(§9.5). 대기 중인 열기 요청은 이 오류로 실패한 것으로 본다 — 프레임에 path 가 없다. */
function handleServerError(frame: Record<string, unknown>): void {
    const code = asString(frame.code) ?? 'unknown';
    const message = asString(frame.message) ?? '알 수 없는 오류가 발생했습니다.';
    log(`문서 소켓 오류 ${code}: ${message}`);

    for (const waiter of openWaiters.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error(message));
    }
    openWaiters.clear();

    // 같은 코드로 반복해 알리지 않는다(§9.8).
    if (warnedCodes.has(code)) {
        return;
    }
    warnedCodes.add(code);
    void vscode.window.showWarningMessage(`Axis Share: ${message}`);
}

/**
 * 예고 없이 끊겼다(§12.10). 편집 전송을 즉시 멈추고, 짧은 유예 뒤에도 못 붙으면 편집기를 잠근 뒤
 * 백오프로 다시 붙는다. 다시 붙으면 열려 있던 파일을 서버 내용으로 통째로 다시 받는다.
 */
function handleSocketClosed(): void {
    const repoId = joinedRepoId;
    const branch = joinedBranch;
    const hadRoom = state === 'active' && repoId !== undefined && branch !== undefined;

    socket = undefined;
    socketGeneration += 1;
    joinedRepoId = undefined;
    joinedBranch = undefined;
    setState('disconnected');

    rejectJoin(new Error('협업 서버 연결이 끊어졌습니다.'));

    for (const waiter of openWaiters.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('협업 서버 연결이 끊어졌습니다.'));
    }
    openWaiters.clear();

    // 붙어 있던 문서는 전부 "떨어짐" 으로 표시한다 — 끊긴 동안에는 편집을 보내지 않는다.
    for (const entry of watching.values()) {
        entry.attached = false;
    }
    emitOpenDocsChange();
    clearFileWatchers(); // 끊긴 동안에는 누가 무엇을 보는지 알 수 없다(§12.10).

    if (!hadRoom || watching.size === 0) {
        return; // 붙어 있던 방이 없다 — 다시 붙을 대상도 없다(다음 파일 열기에서 새로 붙는다).
    }

    if (!docsLocked && !writeRevoked) {
        setDocConnection('reconnecting'); // 상태 표시줄에 눈에 띄게 알린다(§12.10). 잠금 중이면 잠금 표시를 지킨다.
    }
    log(`문서 소켓 연결이 끊어졌습니다. ${LOCK_GRACE_MS}ms 안에 못 붙으면 편집을 잠급니다.`);

    // 짧은 끊김은 유예한다 — 유예 안에 다시 붙으면 잠그지 않는다(§12.10).
    if (!lockTimer) {
        lockTimer = setTimeout(() => {
            lockTimer = undefined;
            lockEditors();
        }, LOCK_GRACE_MS);
    }

    scheduleReconnect(repoId, branch);
}

/** 소켓과 방 상태를 버린다. 다음 파일 열기에서 티켓을 새로 받아 다시 붙는다. */
async function teardown(): Promise<void> {
    const closing = socket;
    socket = undefined;
    socketGeneration += 1;
    joinedRepoId = undefined;
    joinedBranch = undefined;
    joinTarget = undefined;
    setState('disconnected');

    rejectJoin(new Error('협업 세션이 종료되었습니다.'));

    for (const waiter of openWaiters.values()) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('협업 세션이 종료되었습니다.'));
    }
    openWaiters.clear();

    if (closing) {
        try {
            closing.close();
        } catch {
            // 이미 닫힌 소켓이다.
        }
    }
}

// ---------------------------------------------------------------------------
// 재연결·재동기화(§12.10)
// ---------------------------------------------------------------------------

/** 활성 탭이 바뀌었다. 잠긴(또는 권한이 회수된, 제어 소켓이 끊긴) 동안이면 새로 앞으로 나온 우리 문서도 잠근다(§12.10). */
function onActiveEditorChanged(editor: vscode.TextEditor | undefined): void {
    if ((!docsLocked && !writeRevoked && controlJoined) || !editor) {
        return;
    }

    if (entryForUri(editor.document.uri)) {
        void setEditorLocked(editor.document.uri, true);
    }
}

/** 끊긴 방을 기억하고 백오프 뒤에 다시 붙는다(§12.10). 제어 소켓과 같은 규칙이다. */
function scheduleReconnect(repoId: number, branch: string): void {
    reconnectTarget = { repoId, branch };
    if (reconnectTimer) {
        return;
    }

    const delay = Math.round(reconnectDelayMs * (0.8 + Math.random() * 0.4));
    reconnectDelayMs = Math.min(reconnectDelayMs * 2, RECONNECT_MAX_MS);

    log(`문서 소켓을 ${delay}ms 뒤에 다시 연결합니다.`);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        void reconnectNow();
    }, delay);
}

/** 백오프가 돌아왔다 — 다시 붙은 뒤 열려 있던 파일을 서버 내용으로 맞춘다(§12.10). */
async function reconnectNow(): Promise<void> {
    const target = reconnectTarget;
    if (!started || !target) {
        return;
    }

    // 그 사이 방이 바뀌었거나(브랜치 전환) 편집할 파일이 없으면 붙을 이유가 없다.
    const session = getSession();
    if (
        watching.size === 0 ||
        !session ||
        session.repoId !== target.repoId ||
        getCurrentBranch() !== target.branch
    ) {
        cancelReconnect();
        unlockEditors(false);
        return;
    }

    try {
        await ensureJoined(target.repoId, target.branch);
        if (await resyncOpenDocs()) {
            reconnectDelayMs = RECONNECT_MIN_MS;
            cancelReconnect();
            unlockEditors(true);
            log('문서 소켓이 다시 연결되어 서버 내용으로 재동기화했습니다.');
        } else {
            // 못 채운 파일이 있다 — 잠금을 유지한 채 다시 시도한다(끊긴 채 편집하면 안 된다).
            log('일부 파일을 재동기화하지 못했습니다. 잠금을 유지하고 다시 시도합니다.');
            scheduleReconnect(target.repoId, target.branch);
        }
    } catch (error) {
        log(`문서 소켓에 다시 연결하지 못했습니다: ${describe(error)}`);
        if (reconnectTarget) {
            scheduleReconnect(target.repoId, target.branch); // 다음 백오프를 예약한다.
        }
    }
}

/**
 * 열려 있던 파일마다 서버 상태를 다시 받아 통째로 갈아 끼운다(§12.10 서버 우선 재동기화).
 * 한 파일이라도 실패하면 `false` 를 돌려준다 — 호출자가 잠금을 유지하고 다시 시도한다.
 */
async function resyncOpenDocs(): Promise<boolean> {
    let ok = true;
    for (const entry of [...watching.values()]) {
        try {
            await applyServerFrame(entry, await requestOpen(entry.path));
        } catch (error) {
            ok = false;
            log(`재동기화하지 못했습니다(${entry.path}): ${describe(error)}`);
        }
    }

    // 끊긴 동안 회수된 권한이 풀렸을 수 있다 — 재동기화한 서버 상태가 진실이다(§12.9).
    // 열린 문서가 없으면 서버에 물어볼 것도 없다 — 회수를 풀었다고 단정하지 않는다(fail-closed).
    if (writeRevoked && watching.size > 0 && [...watching.values()].every((entry) => entry.canWrite)) {
        applyWriteRevocation(false);
    }

    return ok;
}

/**
 * `perm` 프레임(§9.5, §12.9). 서버가 확정한 쓰기 권한을 세션과 열려 있는 문서에 반영한다.
 * 편집을 보내는 문(`onDocumentChanged`)이 이 값을 보므로, 회수되면 즉시 전송이 멈춘다.
 */
function handlePermissionFrame(frame: Record<string, unknown>): void {
    const canWrite = frame.can_write === true;
    for (const entry of watching.values()) {
        entry.canWrite = canWrite;
    }
    emitOpenDocsChange();
    applyWriteRevocation(!canWrite);
}

/**
 * 저장소와의 인연이 끝났다 — 노드 삭제(`repo_closed`) 또는 권한 상실로 인한 강제 이탈
 * (`reason: authority_lost`, §12.9). 서버는 이 프레임을 보낸 직후 소켓을 닫는다.
 *
 * 제어 소켓도 같은 프레임을 받아 세션을 버리고 안내를 띄운다(`controlSocket.ts`). 여기 처리는
 * **제어 소켓이 못 받았을 때의 안전망**이다 — 세션이 아직 살아 있으면 우리가 안내를 띄우고 버린다.
 * 두 곳이 같은 일을 두 번 해도 결과가 같으므로(멱등) 순서를 따지지 않는다.
 */
function handleRepoClosed(frame: Record<string, unknown>): void {
    if (!getSession()) {
        return; // 제어 소켓이 이미 처리했다.
    }

    const reason = asString(frame.reason) ?? 'repo_closed';
    const message = asString(frame.message) ?? '워크스페이스와의 연결이 종료되었습니다.';
    log('저장소 세션 종료(' + reason + '): ' + message);
    void vscode.window.showWarningMessage('Axis Share: ' + message);
    void clearSession();
}

/**
 * 쓰기 권한 회수·복구를 화면에 반영한다(§12.9). 연결 문제가 아니라 권한 문제라, 재연결로
 * 풀리지 않는다 — 서버가 다시 허용할 때(`perm { can_write: true }`)만 풀린다.
 */
function applyWriteRevocation(revoked: boolean): void {
    if (writeRevoked === revoked) {
        return;
    }

    writeRevoked = revoked;

    if (revoked) {
        if (state === 'active') {
            setDocConnection('readonly');
        }
        for (const entry of watching.values()) {
            void setEditorLocked(entry.uri, true);
        }
        void vscode.window.showWarningMessage(
            'Axis Share: 이 저장소의 편집 권한이 회수되었습니다. 읽기 전용으로 전환했습니다.'
        );
        return;
    }

    // 다시 허용되었다. 연결이 살아 있으면 그대로 풀고, 아니면 재연결 뒤 잠금 해제 경로가 푼다.
    for (const entry of watching.values()) {
        void setEditorLocked(entry.uri, docsLocked || !controlJoined);
    }
    if (state === 'active' && !docsLocked && controlJoined) {
        setDocConnection('active');
    }
    void vscode.window.showInformationMessage('Axis Share: 편집 권한이 복구되었습니다.');
}

/** 유예가 지나도 붙지 못했다 — 열려 있는 우리 문서의 편집을 잠근다(§12.10). */
function lockEditors(): void {
    if (docsLocked || writeRevoked || state === 'active') {
        return;
    }

    docsLocked = true;
    setDocConnection('locked');
    for (const entry of watching.values()) {
        void setEditorLocked(entry.uri, true);
    }

    void vscode.window.showWarningMessage(
        'Axis Share: 협업 서버 연결이 끊어져 편집을 잠갔습니다. 다시 연결되면 서버 내용으로 맞춥니다.'
    );
}

/** 잠금을 푼다(§12.10). `notify` 가 참이면 재연결 사실을 함께 알린다. */
function unlockEditors(notify: boolean): void {
    if (!docsLocked) {
        return;
    }

    docsLocked = false;
    if (writeRevoked) {
        setDocConnection('readonly'); // 권한이 회수된 채 다시 붙었다 — 잠금은 그대로 둔다(§12.9).
    } else if (state === 'active') {
        setDocConnection('active');
    }
    for (const entry of watching.values()) {
        // 제어 소켓이 아직 안 붙었으면 잠금을 유지한다(§12.10) — 그쪽이 풀 때 applyControlGate 가 푼다.
        void setEditorLocked(entry.uri, writeRevoked || !controlJoined);
    }

    if (notify && !writeRevoked) {
        void vscode.window.showInformationMessage(
            'Axis Share: 협업 서버에 다시 연결되었습니다. 서버 내용으로 맞췄습니다.'
        );
    }
}

/**
 * 제어 소켓의 연결 여부를 편집 잠금에 반영한다(§12.10, §12.9).
 *
 * 잠그는 이유는 권한 통보다. 서버가 "누가 어느 브랜치에서 작업 중인지" 를 아는 근거는 접속자
 * 행(presence)이고, 그 행은 제어 소켓이 방에 들어가야 생긴다. 그래서 제어 소켓이 끊긴 동안에는
 * §12.9 의 통보(`perm`·강제 이탈)가 이 세션을 못 보고 지나간다 — heartbeat 안전망도 끊긴
 * 소켓에는 오지 않는다. 그 틈의 편집은 서버가 모르는 채로 공유 doc 에 들어가므로, 다시 붙을
 * 때까지 아예 보내지 않는다(`onDocumentChanged`).
 *
 * 문서 소켓과 달리 유예(3초)를 두지 않는다. 문서 소켓이 끊기면 편집은 어차피 전송되지 않지만
 * (`attached=false`), 제어 소켓이 끊기면 문서 소켓은 멀쩡해서 그대로 전송된다 — presence 가
 * 사라진 순간부터 위험하므로 즉시 잠근다.
 */
function applyControlGate(joined: boolean): void {
    if (controlJoined === joined) {
        return;
    }

    controlJoined = joined;

    if (!joined) {
        for (const entry of watching.values()) {
            void setEditorLocked(entry.uri, true);
        }
        log('제어 소켓이 끊겨 편집을 잠갔습니다(presence 없음 — §12.9 통보를 받을 수 없습니다).');
        return;
    }

    // 다시 붙었다 — presence 가 생기고 §12.9 통보도 다시 닿는다. 다른 이유로 잠겨 있으면
    // (문서 소켓 끊김·권한 회수) 그 경로가 풀 때까지 그대로 둔다.
    if (docsLocked || writeRevoked) {
        return;
    }

    for (const entry of watching.values()) {
        void setEditorLocked(entry.uri, false);
    }
    log('제어 소켓이 다시 붙어 편집 잠금을 풀었습니다.');
}

/** 재연결 예약과 유예 타이머를 버린다(§12.10). 잠금 자체는 `unlockEditors` 가 푼다. */
function cancelReconnect(): void {
    reconnectTarget = undefined;
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
    }
    if (lockTimer) {
        clearTimeout(lockTimer);
        lockTimer = undefined;
    }
}

/** 편집기 하나를 읽기 전용으로 잠그거나 푼다(§12.10). 화면에 없으면 다음에 켤 때 잠근다. */
async function setEditorLocked(uri: vscode.Uri, locked: boolean): Promise<void> {
    const editor = vscode.window.visibleTextEditors.find(
        (candidate) => candidate.document.uri.toString() === uri.toString()
    );
    if (!editor) {
        return;
    }

    try {
        // 활성 편집기여야 명령이 먹는다 — 포커스는 옮기지 않는다(레퍼런스 p2p-code-share 와 같다).
        await vscode.window.showTextDocument(editor.document, {
            viewColumn: editor.viewColumn,
            preserveFocus: true,
            preview: false
        });
        await vscode.commands.executeCommand(
            locked
                ? 'workbench.action.files.setActiveEditorReadonlyInSession'
                : 'workbench.action.files.resetActiveEditorReadonlyInSession'
        );
    } catch {
        // 명령을 지원하지 않는 환경(테스트 호스트 등)이다 — 전송 차단은 그대로 유지된다.
    }
}

/** 서버가 중계한 원격 커서(§9.5). 이 모듈은 좌표를 해석하지 않는다 — 커서 모듈이 한다(§8.10). */
function handleCursorFrame(frame: Record<string, unknown>): void {
    const path = asString(frame.path);
    const userEmail = asString(frame.userEmail);
    if (path === undefined || userEmail === undefined) {
        return;
    }

    cursorEmitter.fire({
        path,
        userEmail,
        userName: asString(frame.userName),
        startRel: frame.startRel,
        endRel: frame.endRel,
        activeRel: frame.activeRel
    });
}

/**
 * 리뷰 데코레이션 1건(§9.5). 이 모듈은 좌표를 해석하지 않는다 — 데코 모듈이 각자의 `Y.Doc` 에서 푼다.
 */
function handleDecorationFrame(frame: Record<string, unknown>): void {
    const path = asString(frame.path);
    const id = asString(frame.id);
    const userEmail = asString(frame.userEmail);
    if (path === undefined || id === undefined || userEmail === undefined) {
        return;
    }

    decorationEmitter.fire({
        path,
        id,
        decoType: asString(frame.decoType),
        memo: asString(frame.memo),
        line: typeof frame.line === 'number' ? frame.line : undefined,
        startRel: frame.startRel,
        endRel: frame.endRel,
        userEmail,
        userName: asString(frame.userName),
        createdAt: asString(frame.createdAt)
    });
}

/** 데코레이션 삭제(§9.5). 지우는 사람의 이메일까지 받지만 화면은 id 만 있으면 지울 수 있다. */
function handleDecorationDeleteFrame(frame: Record<string, unknown>): void {
    const path = asString(frame.path);
    const id = asString(frame.id);
    if (path === undefined || id === undefined) {
        return;
    }

    decorationDeleteEmitter.fire({ path, id });
}

/** 브랜치 리뷰 인덱스(§15.6). 형식이 어긋난 항목은 조용히 버린다 — 서버가 원본을 갖고 있다. */
function handleReviewIndexFrame(frame: Record<string, unknown>): void {
    const branch = asString(frame.branch);
    const raw = frame.reviews;
    if (branch === undefined || !Array.isArray(raw)) {
        return;
    }

    const reviews: RemoteDecoration[] = [];
    for (const item of raw) {
        if (!isRecord(item)) {
            continue;
        }

        const path = asString(item.path);
        const id = asString(item.id);
        const userEmail = asString(item.userEmail);
        if (path === undefined || id === undefined || userEmail === undefined) {
            continue;
        }

        reviews.push(toRemoteDecoration(item, path, id, userEmail));
    }

    reviewIndexEmitter.fire({ branch, reviews });
}

/** 프레임 하나를 `RemoteDecoration` 으로 옮긴다. 서버는 형식을 강제하지 않으므로 여기서 한 번 더 본다. */
function toRemoteDecoration(
    item: Record<string, unknown>,
    path: string,
    id: string,
    userEmail: string
): RemoteDecoration {
    return {
        path,
        id,
        decoType: asString(item.decoType),
        memo: asString(item.memo),
        line: typeof item.line === 'number' ? item.line : undefined,
        startRel: item.startRel,
        endRel: item.endRel,
        userEmail,
        userName: asString(item.userName),
        createdAt: asString(item.createdAt)
    };
}

/** 다른 사용자가 이 파일을 열었다(§9.5). 그 파일을 이미 열고 있는 사람에게만 온다. */
function handlePeerJoin(frame: Record<string, unknown>): void {
    const path = asString(frame.path);
    const userEmail = asString(frame.userEmail);
    if (path === undefined || userEmail === undefined) {
        return;
    }

    addFileWatcher(path, userEmail, asString(frame.userName));
}

/** 다른 사용자가 파일에서 나갔다(§9.5). 서버는 커서 제거를 따로 보내지 않는다 — 이 신호로 지운다. */
function handlePeerLeave(frame: Record<string, unknown>): void {
    const path = asString(frame.path);
    const userEmail = asString(frame.userEmail);
    if (path === undefined || userEmail === undefined) {
        return;
    }

    removeFileWatcher(path, userEmail);
    peerLeaveEmitter.fire({ path, userEmail });
}

// ---------------------------------------------------------------------------
// 파일별 참여자 (Editing 뷰 사람 → 파일 단계, §15.5)
// ---------------------------------------------------------------------------

/** 같은 사람이 탭을 여러 개 열어도 한 줄만 그린다 — 이메일이 신원이다(§12.8). */
function addFileWatcher(path: string, email: string, name: string | undefined): void {
    if (!watching.has(path)) {
        // 이 창이 열지 않은 파일이다(끊긴 사이 서버가 보낸 신호 등). 목록에 넣지 않는다(§15.5).
        return;
    }

    const existing = openFileWatchers.get(path);
    const watchers = existing ? [...existing] : [];
    const index = watchers.findIndex((watcher) => watcher.email === email);
    if (index >= 0) {
        watchers[index] = { email, name };
    } else {
        watchers.push({ email, name });
    }

    openFileWatchers.set(path, watchers);
    filePresenceEmitter.fire();
}

function removeFileWatcher(path: string, email: string): void {
    const existing = openFileWatchers.get(path);
    if (!existing) {
        return;
    }

    const watchers = existing.filter((watcher) => watcher.email !== email);
    if (watchers.length === 0) {
        openFileWatchers.delete(path);
    } else {
        openFileWatchers.set(path, watchers);
    }

    filePresenceEmitter.fire();
}

/** 서버가 준 참여자 목록으로 갈아 끼운다(`opened`, 재동기화). */
function setFileWatchers(path: string, watchers: readonly FileWatcher[]): void {
    if (watchers.length === 0) {
        openFileWatchers.delete(path);
    } else {
        openFileWatchers.set(path, [...watchers]);
    }

    filePresenceEmitter.fire();
}

/** 이 파일에 대한 지식이 더 이상 유효하지 않다(탭을 닫았다·doc 이 버려졌다). */
function forgetFileWatchers(path: string): void {
    if (openFileWatchers.delete(path)) {
        filePresenceEmitter.fire();
    }
}

/** 방 지식이 통째로 무효가 되었다(브랜치 전환·연결 끊김). */
function clearFileWatchers(): void {
    if (openFileWatchers.size === 0) {
        return;
    }

    openFileWatchers.clear();
    filePresenceEmitter.fire();
}

/** `opened.watchers` 를 읽는다. 없거나 형식이 다르면 빈 배열이다. */
function parseFileWatchers(value: unknown): FileWatcher[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const watchers: FileWatcher[] = [];
    for (const item of value) {
        if (!isRecord(item)) {
            continue;
        }

        const email = asString(item.email);
        if (email === undefined || watchers.some((watcher) => watcher.email === email)) {
            continue;
        }

        watchers.push({ email, name: asString(item.name) });
    }

    return watchers;
}

// ---------------------------------------------------------------------------
// 열려 있는 문서 / 커서 (커서·데코 모듈이 쓰는 창구)
// ---------------------------------------------------------------------------

/**
 * 그 브랜치에서 지금 열려 있는 파일과 그 참여자(§15.5). 문서 소켓이 그 브랜치에 붙어 있을 때만
 * 값을 준다 — 소켓 하나가 한 방에만 붙으므로 다른 브랜치의 파일 참여자는 알 수 없다(§9.5).
 */
export function getOpenFilePresence(branch: string): OpenFilePresence[] {
    if (joinedBranch !== branch) {
        return [];
    }

    // 지금 이 창이 열어 둔 파일만 보여 준다 — 감시를 끝낸 파일이 목록에 남지 않게 하는 마지막 기준이다(§15.5).
    const files: OpenFilePresence[] = [];
    for (const path of watching.keys()) {
        const watchers = openFileWatchers.get(path);
        if (watchers !== undefined && watchers.length > 0) {
            files.push({ path, watchers });
        }
    }

    return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** 지금 열려 있는 파일들. 커서 렌더러가 경로·Y.Text 를 얻는 유일한 창구다. */
export function listOpenDocs(): OpenDoc[] {
    return [...watching.values()];
}

/** 로컬 사본 URI 로 열려 있는 문서를 찾는다 — 커서 모듈이 에디터 → doc 을 잇는 데 쓴다. */
export function getOpenDocByUri(uri: vscode.Uri): OpenDoc | undefined {
    return entryForUri(uri);
}

/**
 * 리뷰 데코레이션을 방에 알린다(§9.5). 서버가 그 파일의 `Y.Doc` 에 영속화하고, 같은 파일을 보는
 * 사람에게만 팬아웃한다. **보낸 사람에게는 되돌아오지 않으므로** 화면 반영은 호출자가 낙관적으로 한다.
 */
export function sendDecorationFrame(
    path: string,
    deco: { id: string; decoType: string; memo: string; line: number; startRel: unknown; endRel: unknown }
): boolean {
    return send({ type: 'deco_add', path, ...deco });
}

/** 데코레이션 삭제(§15.6 — 브랜치 쓰기 권한만 본다. 작성자와 무관하게 누구나 지울 수 있다). */
export function sendDecorationDeleteFrame(path: string, id: string): boolean {
    return send({ type: 'deco_del', path, id });
}

/** 내 커서를 방에 알린다. 좌표는 Yjs 상대좌표(JSON)라 상대가 편집해도 위치가 유지된다(§12.8). */
export function sendCursorFrame(
    path: string,
    rels: { startRel: unknown; endRel: unknown; activeRel: unknown }
): boolean {
    return send({ type: 'cursor', path, ...rels });
}

function emitOpenDocsChange(): void {
    openDocsEmitter.fire();
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
        log(`문서 소켓 전송 실패: ${describe(error)}`);
        return false;
    }
}

/** 현재 편집 연결 상태(§12.10). 상태 표시줄이 읽는다. */
export function getDocConnection(): DocConnection {
    return docConnection;
}

function setDocConnection(next: DocConnection): void {
    if (docConnection === next) {
        return;
    }

    docConnection = next;
    docConnectionEmitter.fire(next);
}

function setState(next: DocState): void {
    if (state === next) {
        return;
    }

    state = next;
    log(`문서 소켓 상태: ${next}`);

    // 상태 표시줄용(§12.10). 잠금·권한 회수가 걸려 있으면 그 사실이 가장 중요하다 — 해제는 각 경로가 한다.
    if (writeRevoked) {
        setDocConnection('readonly');
    } else if (docsLocked) {
        setDocConnection('locked');
    } else if (next === 'joining') {
        setDocConnection('joining');
    } else if (next === 'active') {
        setDocConnection('active');
    } else {
        setDocConnection('idle');
    }
}

// ---------------------------------------------------------------------------
// 에디터·경로 유틸
// ---------------------------------------------------------------------------

/** 우리 로컬 사본 탭만 닫는다. 다른 파일 탭은 건드리지 않는다. */
async function closeTab(uri: vscode.Uri): Promise<void> {
    const document = findDocument(uri);
    if (document?.isDirty) {
        try {
            await document.save();
        } catch {
            // 저장에 실패해도 탭은 닫는다 — 로컬 사본은 캐시다(§10.1).
        }
    }

    const key = uri.toString();
    const tabs: vscode.Tab[] = [];
    for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
            const input = tab.input;
            if (input instanceof vscode.TabInputText && input.uri.toString() === key) {
                tabs.push(tab);
            }
        }
    }

    if (tabs.length > 0) {
        await vscode.window.tabGroups.close(tabs);
    }
}

async function reveal(uri: vscode.Uri): Promise<void> {
    await vscode.window.showTextDocument(uri, { preview: false });
}

function findDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
    const key = uri.toString();
    return vscode.workspace.textDocuments.find((document) => document.uri.toString() === key);
}

function entryForUri(uri: vscode.Uri): Watching | undefined {
    const key = uri.toString();
    for (const entry of watching.values()) {
        if (entry.uri.toString() === key) {
            return entry;
        }
    }

    return undefined;
}

function b64ToBytes(value: string): Uint8Array {
    return new Uint8Array(Buffer.from(value, 'base64'));
}

function bytesToB64(value: Uint8Array): string {
    return Buffer.from(value).toString('base64');
}

// ---------------------------------------------------------------------------
// 잡동사니
// ---------------------------------------------------------------------------

function clearJoinTimer(): void {
    if (joinTimer) {
        clearTimeout(joinTimer);
        joinTimer = undefined;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** 확장 호스트 로그. 출력 채널을 붙이게 되면 여기만 바꾸면 된다. */
function log(message: string): void {
    console.log(`[axis-share/doc] ${message}`);
}
