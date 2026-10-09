import * as vscode from 'vscode';
import * as Y from 'yjs';

import { ApiError, apiRequest, getServerBaseUrl } from '../api';
import { getCurrentBranch, getSession, onDidChangeSession } from './repoSession';
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
 * 아직 하지 않는 것: 커서·리뷰 데코레이션(§12.8), 끊김 자동 재접속(§12.10). 다음 단계다.
 */

/** Yjs 공유 텍스트 타입 이름. collab 과 같은 값이어야 한다(§8.5). */
const TEXT_TYPE = 'codetext';

/** `join` 을 보내고 입장 완료(`joined`)를 기다리는 상한. */
const JOIN_TIMEOUT_MS = 10_000;

/** `open` 을 보내고 `opened` 를 기다리는 상한. */
const OPEN_TIMEOUT_MS = 15_000;

/** 로컬 사본 디스크 쓰기 디바운스(§10.1). 타이핑마다 파일을 쓰지 않는다. */
const SAVE_DEBOUNCE_MS = 1_000;

/** 문서 소켓 상태(§10.2 상태 머신 중 이 모듈이 책임지는 구간). */
export type DocState = 'disconnected' | 'joining' | 'active';

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

/** 경로별 `opened` 대기자. */
const openWaiters = new Map<
    string,
    { resolve: (frame: OpenedFrame) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
>();

/** 지금 열려 있는 파일들. 경로가 키다(§12.4 — 같은 파일을 두 번 열지 않는다). */
const watching = new Map<string, Watching>();

/** 같은 오류를 반복해 알리지 않는다(§9.8). */
const warnedCodes = new Set<string>();

const openDocsEmitter = new vscode.EventEmitter<void>();
const cursorEmitter = new vscode.EventEmitter<RemoteCursorFrame>();
const peerLeaveEmitter = new vscode.EventEmitter<FilePeerLeave>();

/** 열려 있는 문서 목록이 바뀌었다(열림·닫힘·브랜치 전환). 커서 렌더러가 이 이벤트로 다시 그린다. */
export const onDidChangeOpenDocs = openDocsEmitter.event;

/** 원격 커서 수신(§12.8). 커서 모듈이 상대좌표를 해석해 화면에 그린다. */
export const onDidReceiveCursor = cursorEmitter.event;

/** 파일 참여자 이탈(§9.5). 서버는 커서 제거를 따로 알리지 않으므로 커서 모듈이 이 신호로 지운다. */
export const onDidReceivePeerLeave = peerLeaveEmitter.event;

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
    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument((event) => onDocumentChanged(event)),
        vscode.workspace.onDidCloseTextDocument((document) => onDocumentClosed(document)),
        onDidChangeSession(() => onSessionChanged()),
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
    watching.clear();
    emitOpenDocsChange();

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
        // 연결이 끊긴 사본이다. 닫고 새로 받는다(§12.10 은 다음 단계).
        watching.delete(path);
        await closeTab(existing.uri);
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
        // 연결이 끊긴 사본이다. 닫고 새로 받는다(§12.10 은 다음 단계).
        watching.delete(path);
        await closeTab(existing.uri);
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
        applyingRemote: 0,
        queue: Promise.resolve(),
        saveTimer: undefined
    };
    watching.set(opened.path, entry);
    emitOpenDocsChange();

    await writeLocalCopy(entry);

    if (options.reveal !== false) {
        await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(uri, { preview: false });
    }

    if (opened.mismatch) {
        void vscode.window.showWarningMessage(
            `Axis Share: ${opened.path} 는 파일과 저장된 편집 내용이 달라, 저장된 편집 내용을 기준으로 열었습니다.`
        );
    }

    if (!opened.canWrite) {
        void vscode.window.showWarningMessage(
            `Axis Share: ${opened.path} 는 읽기 전용 권한입니다. 편집 내용은 서버로 전송되지 않습니다.`
        );
    }

    return uri;
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

    void vscode.window.showInformationMessage(`Axis Share: ${path} 이(가) 되돌려져 편집기에서 닫혔습니다.`);
}

/** 탭이 닫히면 doc 참여를 끝낸다. 서버는 마지막 참여자가 나가면 grace 뒤 flush 한다(§12.4). */
function onDocumentClosed(document: vscode.TextDocument): void {
    const entry = entryForUri(document.uri);
    if (!entry) {
        return;
    }

    watching.delete(entry.path);
    emitOpenDocsChange();
    if (entry.saveTimer) {
        clearTimeout(entry.saveTimer);
    }

    if (entry.attached) {
        send({ type: 'close', path: entry.path });
    }
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
        case 'peer_leave':
            handlePeerLeave(frame);
            return;
        case 'doc_reset':
            void handleDocReset(frame);
            return;
        default:
            // `deco` / `deco_del` 은 리뷰 데코레이션(다음 단계), `peer_join` 은 Editing 뷰의
            // 파일 그룹(§15.5), `flushed` 는 커밋 파이프라인(§12.11)에서 쓴다.
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
        mismatch: frame.mismatch === true
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

/** 예고 없이 끊겼다. 붙어 있던 문서를 전부 "떨어짐" 으로 표시하고 알린다(§12.10 은 다음 단계). */
function handleSocketClosed(): void {
    const wasActive = state === 'active';

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

    for (const entry of watching.values()) {
        entry.attached = false;
    }

    if (wasActive) {
        log('문서 소켓 연결이 끊어졌습니다.');
        void vscode.window.showWarningMessage(
            'Axis Share: 협업 서버 연결이 끊어졌습니다. 편집 내용이 전송되지 않으니 파일을 다시 열어 주세요.'
        );
    }
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

/** 다른 사용자가 파일에서 나갔다(§9.5). 서버는 커서 제거를 따로 보내지 않는다 — 이 신호로 지운다. */
function handlePeerLeave(frame: Record<string, unknown>): void {
    const path = asString(frame.path);
    const userEmail = asString(frame.userEmail);
    if (path === undefined || userEmail === undefined) {
        return;
    }

    peerLeaveEmitter.fire({ path, userEmail });
}

// ---------------------------------------------------------------------------
// 열려 있는 문서 / 커서 (커서·데코 모듈이 쓰는 창구)
// ---------------------------------------------------------------------------

/** 지금 열려 있는 파일들. 커서 렌더러가 경로·Y.Text 를 얻는 유일한 창구다. */
export function listOpenDocs(): OpenDoc[] {
    return [...watching.values()];
}

/** 로컬 사본 URI 로 열려 있는 문서를 찾는다 — 커서 모듈이 에디터 → doc 을 잇는 데 쓴다. */
export function getOpenDocByUri(uri: vscode.Uri): OpenDoc | undefined {
    return entryForUri(uri);
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

function setState(next: DocState): void {
    if (state === next) {
        return;
    }

    state = next;
    log(`문서 소켓 상태: ${next}`);
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
