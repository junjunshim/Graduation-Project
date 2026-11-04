import * as vscode from 'vscode';
import * as Y from 'yjs';

import {
    getOpenDocByUri,
    listOpenDocs,
    onDidChangeOpenDocs,
    onDidReceiveCursor,
    onDidReceivePeerLeave,
    sendCursorFrame,
    type OpenDoc,
    type RemoteCursorFrame
} from './docSocket';
import { getSession } from './repoSession';
import { normalizeEol, toNormalizedOffset, toRawOffset } from './text';
import { userColorHex, userSelectionHex } from './userColors';

/**
 * [TASK_11 §4.3-9 / §12.8] 원격 커서·선택 영역 렌더러.
 *
 * 문서 소켓(docSocket)은 좌표를 해석하지 않고 그대로 중계만 한다(§8.10) — 상대 좌표는 각자의
 * `Y.Doc` 에서만 풀 수 있기 때문이다. 그 해석과 화면 그리기를 이 모듈이 맡는다.
 *
 *   보내기: 에디터 선택 → (버퍼가 Yjs 와 같을 때만) LF 오프셋 → `Y.createRelativePositionFromTypeIndex`
 *           → `cursor { path, startRel, endRel, activeRel }` → 80ms 쓰로틀
 *   받기  : `cursor` 프레임 → `Y.createAbsolutePositionFromRelativePosition` → LF 오프셋 → 원본 오프셋
 *           → `Position` → 40ms 디바운스 → 데코레이션
 *
 * §8.10 의 값비싼 교훈을 그대로 지킨다.
 *   1. 좌표가 잘렸으면 **보내지 않는다** — 버퍼가 Yjs 를 앞서면 오프셋이 문서 끝으로 클램프되고,
 *      그 좌표는 상대 화면에서 파일 끝에 붙는 유령 커서가 된다.
 *   2. 에코 판정은 플래그가 아니라 **내용**으로 한다(docSocket 이 이미 그렇게 한다).
 *   3. 버퍼가 아직 Yjs 를 따라오지 못했으면 이번 렌더를 **건너뛴다** — 이미 그려 둔 좌표가 그대로 남아
 *      커서가 사라지지도, 파일 끝으로 튀지도 않는다(레퍼런스 `lastDrawnPositions` 와 같은 목적).
 *   4. Yjs 는 LF 고정이라 원본이 CRLF 면 `toRawOffset` 으로 되돌린다.
 *   5. 색은 이메일 해시로 **결정적으로** 정한다 — 사이드바 사용자 점과 같은 `ThemeColor`(§15.8).
 *
 * 커서는 저장하지 않는다(휘발성, §8.10). 파일 단위 참여자 표시는 Editing 뷰가 맡는다(§15.5).
 */

/** 내 커서를 보내는 최소 간격(ms). 선택 이벤트는 타이핑마다 오므로 묶어 보낸다(§12.8). */
const SEND_THROTTLE_MS = 80;

/** 같은 상태를 다시 보내지 않는 시간창(ms). 선택·입력 이벤트가 같은 상태를 연달아 알릴 때만 억제한다. */
const DEDUPE_WINDOW_MS = 200;

/** 수신 커서를 다시 그리는 디바운스(ms). 한 파일에 여러 커서가 몰려도 한 번만 그린다(§12.8). */
const RENDER_DEBOUNCE_MS = 40;

/** 이름표를 커서 위로 띄우는 기본 간격(em). 레퍼런스(`CursorManager`)와 같은 값이다. */
const BADGE_BASE_EM = 1.4;

/** 같은 자리에 이름표가 겹칠 때 한 줄씩 더 내리는 간격(em). 레퍼런스와 같은 값이다. */
const BADGE_STACK_EM = 1.5;

/** 한 사용자의 최신 커서. 사용자당 하나만 둔다 — 탭을 여럿 열어도 커서는 하나로 보이면 된다(§8.10). */
type PeerCursor = {
    path: string;
    userName?: string;
    startRel: unknown;
    endRel: unknown;
    activeRel: unknown;
};

/** 상대 좌표를 풀어낸 화면 좌표. */
type DrawnCursor = {
    active: vscode.Position;
    start: vscode.Position;
    end: vscode.Position;
};

/** 그릴 원격 커서 하나(화면 좌표 + 누구인가). */
type RenderedCursor = DrawnCursor & { email: string; peer: PeerCursor };

/** 사용자별 데코레이션 타입. 색·이름표·적층 위치가 바뀔 때만 다시 만든다(타입 수명 관리). */
type PeerDecoration = {
    cursor: vscode.TextEditorDecorationType;
    selection: vscode.TextEditorDecorationType;
    key: string;
};

class CursorRenderer implements vscode.Disposable {
    /** 사용자 이메일 → 최신 커서. 한 사용자는 한 번에 한 파일에만 있다. */
    private readonly peers = new Map<string, PeerCursor>();

    /** 사용자 이메일 → 데코레이션 타입. */
    private readonly decorations = new Map<string, PeerDecoration>();

    /** 경로 → 렌더 디바운스 타이머. */
    private readonly renderTimers = new Map<string, ReturnType<typeof setTimeout>>();

    private readonly disposables: vscode.Disposable[] = [];

    private sendTimer: ReturnType<typeof setTimeout> | undefined;
    private pendingEditor: vscode.TextEditor | undefined;
    private lastSentKey = '';
    private lastSentAt = 0;
    private disposed = false;

    public constructor() {
        this.disposables.push(
            vscode.window.onDidChangeTextEditorSelection((event) => this.queueSend(event.textEditor)),
            // 파일을 열거나 탭을 옮기면 선택 이벤트가 안 올 수 있다 — 활성 에디터 변경도 본다.
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                if (!editor) {
                    return;
                }

                this.queueSend(editor);
                // 화면에 없을 때는 그리지 않았으므로, 탭을 다시 앞으로 가져오면 다시 그린다.
                const open = getOpenDocByUri(editor.document.uri);
                if (open) {
                    this.scheduleRender(open.path);
                }
            }),
            // 로컬 편집으로 Yjs 가 움직이면 상대 커서도 따라 움직여야 한다.
            vscode.workspace.onDidChangeTextDocument((event) => {
                const open = getOpenDocByUri(event.document.uri);
                if (open) {
                    this.scheduleRender(open.path);
                }
            }),
            // 테마가 바뀌면 위에서 고른 hex 색이 낡는다 — 데코레이션을 버리고 다시 그린다.
            vscode.window.onDidChangeActiveColorTheme(() => this.onThemeChanged()),
            onDidChangeOpenDocs(() => this.onOpenDocsChanged()),
            onDidReceiveCursor((frame) => this.onRemoteCursor(frame)),
            // 서버는 커서 제거를 따로 알리지 않는다 — 파일을 떠난 사용자의 커서를 이 신호로 지운다(§9.5).
            onDidReceivePeerLeave((frame) => {
                const peer = this.peers.get(frame.userEmail);
                if (peer && peer.path === frame.path) {
                    this.forget(frame.userEmail);
                }
            })
        );
    }

    public dispose(): void {
        if (this.disposed) {
            return;
        }

        this.disposed = true;
        for (const timer of this.renderTimers.values()) {
            clearTimeout(timer);
        }
        this.renderTimers.clear();

        if (this.sendTimer) {
            clearTimeout(this.sendTimer);
            this.sendTimer = undefined;
        }

        for (const email of [...this.decorations.keys()]) {
            this.disposeDecoration(email);
        }
        this.peers.clear();

        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables.length = 0;
    }

    // -----------------------------------------------------------------------
    // 보내기
    // -----------------------------------------------------------------------

    /** 선택이 바뀔 때마다 보내지 않고 묶어서 보낸다(§12.8). */
    private queueSend(editor: vscode.TextEditor): void {
        if (this.disposed || !getSession()) {
            return;
        }

        this.pendingEditor = editor;
        if (this.sendTimer) {
            return;
        }

        this.sendTimer = setTimeout(() => {
            this.sendTimer = undefined;
            const pending = this.pendingEditor;
            this.pendingEditor = undefined;
            if (pending) {
                this.sendOwnCursor(pending);
            }
        }, SEND_THROTTLE_MS);
    }

    /** 내 커서·선택 영역을 상대 좌표로 바꿔 방에 알린다(§12.8). */
    private sendOwnCursor(editor: vscode.TextEditor): void {
        const open = getOpenDocByUri(editor.document.uri);
        if (!open || !open.attached || !open.canWrite) {
            return; // 우리 로컬 사본이 아니거나, 끊겼거나, 읽기 전용이다.
        }

        const document = editor.document;
        const raw = document.getText();
        // 버퍼가 Yjs 를 앞서면(권한 없는 편집·적용 실패) 오프셋이 문서 끝으로 잘려 "끝 앵커"가 오염된다.
        // 그 좌표는 상대 화면에서 파일 끝에 붙으므로 아예 보내지 않는다(§8.10-1).
        if (normalizeEol(raw) !== open.text.toString()) {
            return;
        }

        const selection = editor.selection;
        const start = toNormalizedOffset(raw, document.offsetAt(selection.start));
        const end = toNormalizedOffset(raw, document.offsetAt(selection.end));
        const active = toNormalizedOffset(raw, document.offsetAt(selection.active));
        if (start > open.text.length || end > open.text.length || active > open.text.length) {
            return;
        }

        const key =
            `${open.path}|${document.version}|${selection.start.line}:${selection.start.character}|` +
            `${selection.end.line}:${selection.end.character}|${selection.active.line}:${selection.active.character}`;
        if (key === this.lastSentKey && Date.now() - this.lastSentAt < DEDUPE_WINDOW_MS) {
            return;
        }

        const sent = sendCursorFrame(open.path, {
            startRel: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(open.text, start)),
            endRel: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(open.text, end)),
            activeRel: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(open.text, active))
        });
        if (!sent) {
            return; // 소켓이 아직 없다 — 다음 이동에서 다시 시도한다.
        }

        this.lastSentKey = key;
        this.lastSentAt = Date.now();
    }

    // -----------------------------------------------------------------------
    // 받기
    // -----------------------------------------------------------------------

    /** 서버가 중계한 커서를 사용자별 최신 상태로 갈아 끼우고 다시 그린다(§12.8). */
    private onRemoteCursor(frame: RemoteCursorFrame): void {
        const me = getSession()?.userEmail;
        if (me !== undefined && frame.userEmail === me) {
            return; // 서버가 발신자를 빼지만 방어한다.
        }

        const previous = this.peers.get(frame.userEmail);
        if (previous && previous.path !== frame.path) {
            // 같은 사용자가 다른 파일로 옮겼다 — 이전 파일에 남은 유령 커서를 지운다.
            this.forget(frame.userEmail);
        }

        this.peers.set(frame.userEmail, {
            path: frame.path,
            userName: frame.userName,
            startRel: frame.startRel,
            endRel: frame.endRel,
            activeRel: frame.activeRel
        });
        this.scheduleRender(frame.path);
    }

    /** 테마(라이트/다크/고대비)가 바뀌면 색을 다시 고르고 다시 그린다. */
    private onThemeChanged(): void {
        for (const email of [...this.decorations.keys()]) {
            this.disposeDecoration(email);
        }

        for (const open of listOpenDocs()) {
            this.scheduleRender(open.path);
        }
    }

    /** 열려 있는 파일 목록이 바뀌면 더 이상 보지 않는 파일의 커서를 버리고 나머지를 다시 그린다. */
    private onOpenDocsChanged(): void {
        const paths = new Set(listOpenDocs().map((open) => open.path));

        for (const [email, peer] of [...this.peers]) {
            if (!paths.has(peer.path)) {
                this.forget(email);
            }
        }

        for (const path of paths) {
            this.scheduleRender(path);
        }
    }

    // -----------------------------------------------------------------------
    // 그리기
    // -----------------------------------------------------------------------

    /** 같은 파일에 커서 변경이 몰려도 한 번만 그린다(§12.8 40ms 디바운스). */
    private scheduleRender(path: string): void {
        if (this.disposed || this.renderTimers.has(path)) {
            return;
        }

        const timer = setTimeout(() => {
            this.renderTimers.delete(path);
            this.renderPath(path);
        }, RENDER_DEBOUNCE_MS);
        this.renderTimers.set(path, timer);
    }

    /** 한 파일의 원격 커서·선택 영역을 다시 그린다. */
    private renderPath(path: string): void {
        const open = listOpenDocs().find((candidate) => candidate.path === path);
        if (!open) {
            return;
        }

        const document = findDocument(open.uri);
        const editors = vscode.window.visibleTextEditors.filter(
            (editor) => editor.document.uri.toString() === open.uri.toString()
        );
        if (!document || editors.length === 0) {
            return; // 화면에 없는 탭이다 — 상태만 남겨 두고 다음에 다시 그린다.
        }

        const cursors = this.collectCursors(open, document);
        if (!cursors) {
            return; // 버퍼가 아직 Yjs 를 따라오지 못했다 — 직전 그림을 그대로 둔다(§8.10-3).
        }

        // 같은 자리에 이름표가 겹치면 세로로 쌓는다(결정적 순서: 이메일).
        const stacks = new Map<string, string[]>();
        for (const cursor of cursors) {
            const key = `${cursor.active.line}:${cursor.active.character}`;
            const group = stacks.get(key);
            if (group) {
                group.push(cursor.email);
            } else {
                stacks.set(key, [cursor.email]);
            }
        }
        for (const group of stacks.values()) {
            group.sort();
        }

        for (const cursor of cursors) {
            const stack = stacks.get(`${cursor.active.line}:${cursor.active.character}`) ?? [];
            const decoration = this.decorationFor(cursor.email, cursor.peer, Math.max(stack.indexOf(cursor.email), 0));
            for (const editor of editors) {
                editor.setDecorations(decoration.cursor, [new vscode.Range(cursor.active, cursor.active)]);
                editor.setDecorations(decoration.selection, [new vscode.Range(cursor.start, cursor.end)]);
            }
        }
    }

    /** 이 파일의 커서들을 화면 좌표로 푼다. 버퍼가 어긋나 있으면 `undefined`(이번 렌더를 건너뛴다). */
    private collectCursors(open: OpenDoc, document: vscode.TextDocument): RenderedCursor[] | undefined {
        const raw = document.getText();
        if (normalizeEol(raw) !== open.text.toString()) {
            return undefined;
        }

        const cursors: RenderedCursor[] = [];
        for (const [email, peer] of [...this.peers]) {
            if (peer.path !== open.path) {
                continue;
            }

            const drawn = this.resolveCursor(open, document, raw, email, peer);
            if (drawn) {
                cursors.push({ ...drawn, email, peer });
            }
        }

        return cursors;
    }

    /** 상대 좌표를 화면 좌표로. 활성 앵커가 사라졌으면 그 사용자의 커서를 버린다. */
    private resolveCursor(
        open: OpenDoc,
        document: vscode.TextDocument,
        raw: string,
        email: string,
        peer: PeerCursor
    ): DrawnCursor | undefined {
        const active = resolveIndex(open, peer.activeRel);
        if (active === undefined) {
            // 상대가 지운 자리에 앵커가 있었다 — 더는 의미 있는 위치가 없다.
            this.forget(email);
            return undefined;
        }

        const start = resolveIndex(open, peer.startRel) ?? active;
        const end = resolveIndex(open, peer.endRel) ?? active;
        const max = open.text.length;
        return {
            active: toPosition(document, raw, active, max),
            start: toPosition(document, raw, start, max),
            end: toPosition(document, raw, end, max)
        };
    }

    /**
     * 사용자 데코레이션 타입. 색·이름표·적층 위치가 그대로면 만들어 둔 것을 재사용한다.
     * 배지 모양은 레퍼런스(`CursorManager.applyPeerDecorationWithPositions`)를 그대로 가져왔다 —
     * 흰 글자 + 어두운 외곽선(text-shadow)이라 배경색이 무엇이든, 배경이 적용되지 않아도 읽힌다.
     */
    private decorationFor(email: string, peer: PeerCursor, rank: number): PeerDecoration {
        const name = displayName(email, peer.userName);
        const badgeFontSize = badgeFontSizePx();
        const key = `${name}|${rank}|${badgeFontSize}`;
        const cached = this.decorations.get(email);
        if (cached && cached.key === key) {
            return cached;
        }
        if (cached) {
            cached.cursor.dispose();
            cached.selection.dispose();
        }

        const color = userColorHex(email);
        const decoration: PeerDecoration = {
            cursor: vscode.window.createTextEditorDecorationType({
                // 자리 표시는 왼쪽 2px 막대(레퍼런스와 같다).
                borderWidth: '0 0 0 2px',
                borderStyle: 'solid',
                borderColor: color,
                overviewRulerColor: color,
                overviewRulerLane: vscode.OverviewRulerLane.Right,
                after: {
                    contentText: name,
                    backgroundColor: color,
                    color: '#ffffff',
                    fontWeight: 'bold',
                    // 적층 순위만큼 아래로 내려 이름표가 서로 가리지 않게 한다.
                    margin: `${BADGE_BASE_EM + rank * BADGE_STACK_EM}em 0 0 0`,
                    textDecoration:
                        `none; font-size: ${badgeFontSize}px; padding: 1px 4px; border-radius: 3px;` +
                        ` position: absolute; z-index: ${1000 - rank}; white-space: nowrap; line-height: 1;` +
                        ' box-shadow: 0 2px 4px rgba(0,0,0,0.3);' +
                        ' text-shadow: -1px -1px 0 rgba(0,0,0,0.8), 1px -1px 0 rgba(0,0,0,0.8),' +
                        ' -1px 1px 0 rgba(0,0,0,0.8), 1px 1px 0 rgba(0,0,0,0.8);'
                }
            }),
            // 선택 영역은 같은 색의 반투명 변형 — 글자를 가리지 않는다.
            selection: vscode.window.createTextEditorDecorationType({ backgroundColor: userSelectionHex(email) }),
            key
        };
        this.decorations.set(email, decoration);
        return decoration;
    }

    /** 사용자의 커서 상태와 데코레이션을 버린다(파일 이동·앵커 소실 — 유령 커서 방지). */
    private forget(email: string): void {
        this.peers.delete(email);
        this.disposeDecoration(email);
    }

    private disposeDecoration(email: string): void {
        const decoration = this.decorations.get(email);
        if (!decoration) {
            return;
        }

        decoration.cursor.dispose();
        decoration.selection.dispose();
        this.decorations.delete(email);
    }
}

/** 상대 좌표(JSON)를 지금 문서의 LF 오프셋으로 푼다. 앵커가 없으면 `undefined`. */
function resolveIndex(open: OpenDoc, rel: unknown): number | undefined {
    if (rel === null || typeof rel !== 'object') {
        return undefined;
    }

    try {
        const absolute = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(rel), open.doc);
        return absolute ? absolute.index : undefined;
    } catch {
        return undefined; // 서버가 해석하지 않고 그대로 중계한 값이다 — 형식이 깨져 있어도 죽지 않는다.
    }
}

/** LF 오프셋을 원본 오프셋 → `Position` 으로. 문서 길이를 넘는 값은 끝으로 클램프한다. */
function toPosition(document: vscode.TextDocument, raw: string, lfIndex: number, max: number): vscode.Position {
    const index = Math.min(Math.max(lfIndex, 0), max);
    return document.positionAt(Math.min(toRawOffset(raw, index), raw.length));
}

/** 우리 로컬 사본을 띄운 문서. 화면에 없어도(백그라운드 탭) 버퍼는 살아 있다. */
function findDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
    const key = uri.toString();
    return vscode.workspace.textDocuments.find((document) => document.uri.toString() === key);
}

/** 이름표 글꼴 크기(px). 레퍼런스와 같이 에디터 글꼴의 80%, 최소 9px. */
function badgeFontSizePx(): number {
    const fontSize = vscode.workspace.getConfiguration('editor').get<number>('fontSize') ?? 14;
    return Math.max(9, Math.round(fontSize * 0.8));
}

/** 이름표 글자. 이름이 없으면 이메일 앞부분(사이드바와 같은 규칙, §15.5). */
function displayName(email: string, userName: string | undefined): string {
    const name = userName?.trim();
    if (name) {
        return name;
    }

    return email.split('@')[0] || email;
}

let renderer: CursorRenderer | undefined;

/** 원격 커서 렌더러를 켠다. `extension.ts` activate 에서 한 번 부른다. */
export function startCursorRenderer(context: vscode.ExtensionContext): void {
    if (renderer) {
        return;
    }

    renderer = new CursorRenderer();
    context.subscriptions.push(renderer);
}

/** 렌더러를 끄고 그려 둔 데코레이션을 모두 지운다(확장 종료). */
export function stopCursorRenderer(): void {
    renderer?.dispose();
    renderer = undefined;
}
