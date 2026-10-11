import * as vscode from 'vscode';
import * as Y from 'yjs';

import {
    getOpenDocByUri,
    listOpenDocs,
    onDidReceiveDecoration,
    onDidReceiveDecorationDelete,
    onDidReceiveReviewIndex,
    openRepoFile,
    sendDecorationDeleteFrame,
    sendDecorationFrame,
    type OpenDoc,
    type RemoteDecoration
} from './docSocket';
import { getSession, onDidChangeSession } from './repoSession';
import { normalizeEol, toNormalizedOffset, toRawOffset } from './text';

/**
 * [TASK_11 §8.10 / §15.6] 리뷰 데코레이션 — 추가·이동·삭제·표시 토글과 그 목록(인덱스).
 *
 * 데코레이션은 **파일의 `Y.Doc` 안에** 저장된다(DECO_MAP). 서버는 내용을 해석하지 않고 중계·보관만
 * 하므로(§8.10), 좌표를 푸는 일은 각 클라이언트의 `Y.Doc` 에서만 일어난다 — 이 모듈이 그 창구다.
 *
 * 값이 흐르는 길은 셋이다.
 *   1. 방에 들어가면 브랜치 리뷰 인덱스 스냅샷(`reviews`)이 한 번 온다 → 목록을 통째로 교체한다.
 *      이 덕분에 **파일을 열지 않아도** 사이드바가 목록을 그린다(§15.6).
 *   2. 누가 추가·변경하면 `deco` 프레임이 같은 파일을 보는 사람에게 온다 → 목록에 반영한다.
 *   3. 누가 지우면 `deco_del` 프레임이 온다(삭제는 누구나 가능 — 브랜치 쓰기 권한만 본다).
 *
 * 내가 추가한 것은 서버가 나에게 되돌려 주지 않으므로(발신자 제외 팬아웃) **낙관적으로** 먼저 반영한다.
 *
 * §8.10 의 값비싼 교훈을 지킨다.
 *   - 좌표가 클램프되면 저장하지 않는다 — 클램프된 상대 좌표는 나중에 문서 끝에 붙는다(경계 검사로 막는다).
 *   - 앵커가 사라진 데코레이션은 그리지 않는다(문서가 그 자리를 지웠다).
 *   - Yjs 텍스트는 LF 고정이라 화면 좌표로 되돌릴 때 `toRawOffset` 을 쓴다.
 */

/** 데코레이션 종류 5종(레퍼런스 그대로 — §15.6). */
export type DecoType = 'Typo' | 'Grammar' | 'Logical' | 'Other' | 'Highlight';

/** 종류 순서. 빠른 선택 목록에 쓰는 순서이기도 하다. */
export const DECO_TYPES: readonly DecoType[] = ['Typo', 'Grammar', 'Logical', 'Other', 'Highlight'];

/** 사람이 읽는 이름. */
const TYPE_LABELS: Record<DecoType, string> = {
    Typo: '오타',
    Grammar: '문법 오류',
    Logical: '논리 오류',
    Other: '기타',
    Highlight: '강조'
};

/** `package.json` 의 `axis-share.deco.*` 기본값과 같은 값. 두 곳은 함께 고쳐야 한다. */
const PALETTE: Record<DecoType, { dark: string; light: string; contrast: string }> = {
    Typo: { dark: '#f28b82', light: '#d9534f', contrast: '#ff9e94' },
    Grammar: { dark: '#fdd663', light: '#f0ad4e', contrast: '#ffe07a' },
    Logical: { dark: '#ff8a80', light: '#d84315', contrast: '#ffa094' },
    Other: { dark: '#9e9e9e', light: '#757575', contrast: '#c0c0c0' },
    Highlight: { dark: '#aed581', light: '#7cb342', contrast: '#c4e6a1' }
};

/** 배경 투명도(2자리 hex). 글자를 가리지 않을 만큼만 칠하고, 강조만 조금 진하게 한다. */
const WASH_ALPHA: Record<DecoType, string> = {
    Typo: '1F',
    Grammar: '1F',
    Logical: '1F',
    Other: '1F',
    Highlight: '38'
};

/** 밑줄 모양. 기타만 실선, 강조는 밑줄 없이 배경만 칠한다(레퍼런스와 같은 구분). */
const UNDERLINE: Record<DecoType, string> = {
    Typo: 'underline wavy',
    Grammar: 'underline wavy',
    Logical: 'underline wavy',
    Other: 'underline solid',
    Highlight: 'none'
};

/** 표시 토글을 뷰 타이틀 아이콘과 맞추기 위한 컨텍스트 키(`package.json` 의 when 절이 읽는다). */
export const CONTEXT_DECORATIONS_VISIBLE = 'axis-share:decorationsVisible';

/** 리뷰 데코레이션 1건. 서버가 보관하는 JSON 과 같은 모양을 유지한다(§9.5). */
export type Decoration = {
    id: string;
    path: string;
    decoType: DecoType;
    memo: string;
    userEmail: string;
    userName?: string;
    createdAt: string;
    /** 표시용 줄 스냅샷(0-based). 열린 doc 이 있으면 상대 좌표로 계산한 값이 우선이다. */
    line?: number;
    startRel?: unknown;
    endRel?: unknown;
};

export function isDecoType(value: unknown): value is DecoType {
    return typeof value === 'string' && (DECO_TYPES as readonly string[]).includes(value);
}

/** 서버가 보낸 종류 문자열을 우리 타입으로 좁힌다. 모르는 값은 기타로 본다(화면이 비지 않게). */
export function toDecoType(value: unknown): DecoType {
    return isDecoType(value) ? value : 'Other';
}

export function decoLabel(type: DecoType): string {
    return TYPE_LABELS[type];
}

/** 등록 색 id. `ThemeIcon` 색(사이드바 점)에 쓴다. */
export function decoColorId(type: DecoType): string {
    return `axis-share.deco.${type.toLowerCase()}`;
}

export function decoColor(type: DecoType): vscode.ThemeColor {
    return new vscode.ThemeColor(decoColorId(type));
}

export function decoIcon(type: DecoType): vscode.ThemeIcon {
    return new vscode.ThemeIcon('circle-filled', decoColor(type));
}

/**
 * 지금 테마에 맞는 hex. 에디터 인라인 데코레이션은 등록 색 id 를 해석하지 못해서
 * (userColors.ts 의 2026-10-09 관찰과 같은 이유) hex 를 직접 쓴다.
 */
export function decoColorHex(type: DecoType): string {
    const entry = PALETTE[type];
    switch (vscode.window.activeColorTheme.kind) {
        case vscode.ColorThemeKind.Light:
            return entry.light;
        case vscode.ColorThemeKind.Dark:
            return entry.dark;
        default:
            return entry.contrast; // HighContrast / HighContrastLight
    }
}

/** 같은 색의 반투명 배경. */
export function decoWashHex(type: DecoType): string {
    return `${decoColorHex(type)}${WASH_ALPHA[type]}`;
}

/** 밑줄 CSS. `textDecoration` 은 theme color 를 받지 않아 색을 hex 로 붙인다. */
export function decoTextDecoration(type: DecoType): string {
    const underline = UNDERLINE[type];
    return underline === 'none' ? 'none' : `${underline} ${decoColorHex(type)}`;
}

// ---------------------------------------------------------------------------
// 목록(인덱스)
// ---------------------------------------------------------------------------

/** 경로 → (id → 데코레이션). 서버 스냅샷과 증분 프레임이 이 하나로 모인다. */
const byPath = new Map<string, Map<string, Decoration>>();

const changeEmitter = new vscode.EventEmitter<void>();

/** 목록이 바뀌었다. Reviews 트리와 인라인 렌더러가 이 이벤트로 다시 그린다. */
export const onDidChangeDecorations = changeEmitter.event;

export function findDecoration(path: string, id: string): Decoration | undefined {
    return byPath.get(path)?.get(id);
}

export function decorationCount(): number {
    let total = 0;
    for (const group of byPath.values()) {
        total += group.size;
    }

    return total;
}

/** 데코레이션이 있는 파일들(경로 오름차순). 각 파일의 데코레이션은 줄 → 생성시각 순이다. */
export function decorationFiles(): { path: string; decorations: Decoration[] }[] {
    const files = [...byPath.entries()].map(([path, group]) => ({
        path,
        decorations: sortDecorations([...group.values()])
    }));

    files.sort((a, b) => a.path.localeCompare(b.path));
    return files;
}

export function decorationsForPath(path: string): Decoration[] {
    const group = byPath.get(path);
    return group ? sortDecorations([...group.values()]) : [];
}

/** 서버가 준 브랜치 스냅샷으로 통째로 교체한다(방에 들어갈 때마다 온다 — §15.6). */
function replaceAll(records: readonly RemoteDecoration[]): void {
    byPath.clear();
    for (const record of records) {
        upsertRecord(toDecoration(record), false);
    }

    changeEmitter.fire();
}

function upsertRecord(decoration: Decoration, emit = true): void {
    let group = byPath.get(decoration.path);
    if (!group) {
        group = new Map<string, Decoration>();
        byPath.set(decoration.path, group);
    }

    group.set(decoration.id, decoration);
    if (emit) {
        changeEmitter.fire();
    }
}

/** 데코레이션을 목록에서 지운다(서버 프레임을 받았거나, 내가 지웠거나). */
export function removeDecoration(path: string, id: string): void {
    const group = byPath.get(path);
    if (!group || !group.delete(id)) {
        return;
    }

    if (group.size === 0) {
        byPath.delete(path);
    }

    changeEmitter.fire();
}

function clearDecorations(): void {
    if (byPath.size === 0) {
        return;
    }

    byPath.clear();
    changeEmitter.fire();
}

/** 줄 → 생성시각 → id. 서버 인덱스와 같은 순서를 유지한다. */
function sortDecorations(records: Decoration[]): Decoration[] {
    return records.sort((a, b) => {
        const aLine = typeof a.line === 'number' ? a.line : Number.MAX_SAFE_INTEGER;
        const bLine = typeof b.line === 'number' ? b.line : Number.MAX_SAFE_INTEGER;
        if (aLine !== bLine) {
            return aLine - bLine;
        }

        if (a.createdAt !== b.createdAt) {
            return a.createdAt < b.createdAt ? -1 : 1;
        }

        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

function toDecoration(frame: RemoteDecoration): Decoration {
    return {
        id: frame.id,
        path: frame.path,
        decoType: toDecoType(frame.decoType),
        memo: frame.memo ?? '',
        userEmail: frame.userEmail,
        userName: frame.userName,
        createdAt: frame.createdAt ?? '',
        line: typeof frame.line === 'number' ? frame.line : undefined,
        startRel: frame.startRel,
        endRel: frame.endRel
    };
}

/** 작성자 표시 이름. 이름이 없으면 이메일 앞부분을 쓴다(사이드바·커서와 같은 규칙). */
export function authorLabel(decoration: Decoration): string {
    const name = decoration.userName?.trim();
    if (name) {
        return name;
    }

    return decoration.userEmail.split('@')[0] || decoration.userEmail;
}

/**
 * 서버가 보낸 시각 문자열을 화면용으로 바꾼다.
 * PostgreSQL timestamptz 를 Drogon 이 `2026-10-08 12:20:19.436217+00` 형태로 넘기므로
 * 공백을 `T` 로 바꿔 파싱하고, 파싱이 안 되면 원문을 그대로 보여 준다(§15.5 와 같은 규칙).
 */
export function formatTimestamp(value: string | undefined): string | undefined {
    if (!value) {
        return undefined;
    }

    const parsed = new Date(value.replace(' ', 'T'));
    return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('ko-KR');
}

/** 메모 첫 줄. 비었으면 종류 이름을 대신 쓴다(§15.6 라벨 규칙). */
export function memoLabel(decoration: Decoration): string {
    const first = decoration.memo.split('\n')[0]?.trim() ?? '';
    return first === '' ? decoLabel(decoration.decoType) : first;
}

// ---------------------------------------------------------------------------
// 좌표 해석 (커서 렌더러와 같은 규칙 — §8.10)
// ---------------------------------------------------------------------------

/** 상대 좌표(JSON)를 지금 문서의 LF 오프셋으로 푼다. 앵커가 사라졌으면 undefined. */
export function resolveIndex(open: OpenDoc, rel: unknown): number | undefined {
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

/** LF 오프셋 → 원본 오프셋 → `Position`. 문서 길이를 넘는 값은 끝으로 클램프한다. */
export function offsetToPosition(
    document: vscode.TextDocument,
    raw: string,
    lfIndex: number,
    max: number
): vscode.Position {
    const index = Math.min(Math.max(lfIndex, 0), max);
    return document.positionAt(Math.min(toRawOffset(raw, index), raw.length));
}

/** 열려 있는 문서(로컬 사본). 화면에 없어도(백그라운드 탭) 버퍼는 살아 있다. */
function findDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
    const key = uri.toString();
    return vscode.workspace.textDocuments.find((document) => document.uri.toString() === key);
}

/** 우리 로컬 사본이 열려 있으면 그 doc 을 준다(§12.4 — 경로가 키다). */
export function findOpenDoc(path: string): OpenDoc | undefined {
    return listOpenDocs().find((open) => open.path === path);
}

/**
 * 버퍼가 Yjs 와 같으면 원본 텍스트를, 다르면 `undefined` 를 준다.
 *
 * 같지 않다는 것은 우리 화면이 아직 Yjs 를 따라오지 못했다는 뜻이다. 그때 오프셋을 해석하면
 * 문서 끝으로 클램프된 좌표가 나오고, 커서·데코가 파일 끝에 붙는다(§8.10-3). 그래서 호출자는
 * 이 함수가 `undefined` 를 주면 **직전 그림을 그대로 둔다**.
 */
export function synchronizedText(open: OpenDoc, document: vscode.TextDocument): string | undefined {
    const raw = document.getText();
    return normalizeEol(raw) === open.text.toString() ? raw : undefined;
}

/** 데코레이션의 상대 좌표를 화면 범위로 푼다. 버퍼가 어긋나 있으면 `undefined`(그리지 않는다). */
export function resolveDecorationRange(
    open: OpenDoc,
    document: vscode.TextDocument,
    raw: string,
    decoration: Decoration
): vscode.Range | undefined {
    const startIndex = resolveIndex(open, decoration.startRel);
    if (startIndex === undefined) {
        return undefined;
    }

    const endIndex = resolveIndex(open, decoration.endRel) ?? startIndex;
    const max = open.text.length;
    return new vscode.Range(
        offsetToPosition(document, raw, startIndex, max),
        offsetToPosition(document, raw, Math.max(endIndex, startIndex), max)
    );
}

/**
 * 트리가 한 파일의 줄 번호를 여러 번 물을 때 `getText()` 를 다시 만들지 않는다.
 * 같은 문서 버전이면 본문이 그대로라는 뜻이다(에디터가 바뀌면 version 이 오른다).
 */
let textCache: { key: string; raw: string | undefined } | undefined;

function cachedRaw(open: OpenDoc, document: vscode.TextDocument): string | undefined {
    const key = `${document.uri.toString()}|${document.version}`;
    if (textCache && textCache.key === key) {
        return textCache.raw;
    }

    const raw = synchronizedText(open, document);
    textCache = { key, raw };
    return raw;
}

/**
 * 목록에 쓸 줄 번호(0-based). 파일이 열려 있으면 상대 좌표에서 다시 계산하고,
 * 아니면 추가할 때 저장한 표시용 스냅샷을 쓴다(§15.6).
 */
export function decorationLine(decoration: Decoration): number | undefined {
    const open = findOpenDoc(decoration.path);
    if (!open) {
        return decoration.line;
    }

    const document = findDocument(open.uri);
    if (!document) {
        return decoration.line;
    }

    const raw = cachedRaw(open, document);
    if (raw === undefined) {
        return decoration.line;
    }

    const index = resolveIndex(open, decoration.startRel);
    return index === undefined ? decoration.line : offsetToPosition(document, raw, index, open.text.length).line;
}

// ---------------------------------------------------------------------------
// 표시 토글 (§15.6 — 설정 `axis-share.showDecorations` 로 영속화)
// ---------------------------------------------------------------------------

/** 인라인 데코레이션을 그릴지. 사이드바 목록은 이 값과 무관하게 유지된다. */
export function decorationsVisible(): boolean {
    return vscode.workspace.getConfiguration('axis-share').get<boolean>('showDecorations') ?? true;
}

/** 뷰 타이틀 아이콘($(eye)/$(eye-closed))을 현재 설정에 맞춘다. */
async function syncVisibilityContext(): Promise<void> {
    await vscode.commands.executeCommand('setContext', CONTEXT_DECORATIONS_VISIBLE, decorationsVisible());
}

// ---------------------------------------------------------------------------
// 수명주기
// ---------------------------------------------------------------------------

let disposables: vscode.Disposable[] = [];

/**
 * 데코레이션 모듈을 켠다. `extension.ts` activate 에서 한 번 부른다.
 * 서버 프레임 구독은 여기서만 걸고, 화면 그리기는 decorationRenderer 가 이 목록을 읽어서 한다.
 */
export function startDecorations(context: vscode.ExtensionContext): void {
    if (disposables.length > 0) {
        return;
    }

    disposables = [
        // 방에 들어가자마자 오는 브랜치 스냅샷. 이걸로 파일을 열지 않아도 목록이 채워진다(§15.6).
        // 이 프레임은 우리가 join 한 방의 인덱스이므로 브랜치 이름을 따로 대조하지 않는다 —
        // 브랜치를 바꾸면 문서 소켓이 다시 join 하고 새 스냅샷이 이 목록을 통째로 교체한다(§10.3).
        onDidReceiveReviewIndex((frame) => replaceAll(frame.reviews)),
        onDidReceiveDecoration((frame) => upsertRecord(toDecoration(frame))),
        onDidReceiveDecorationDelete((frame) => removeDecoration(frame.path, frame.id)),
        // 세션이 끊기면(앱에서 연결 해제) 목록도 비운다 — 다음 연결의 스냅샷이 다시 채운다.
        onDidChangeSession(() => {
            if (!getSession()) {
                clearDecorations();
            }
        }),
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('axis-share.showDecorations')) {
                void syncVisibilityContext();
            }
        })
    ];

    context.subscriptions.push(...disposables);
    void syncVisibilityContext();
}

/** 모듈을 끄고 목록을 비운다(확장 종료). */
export function stopDecorations(): void {
    for (const disposable of disposables) {
        disposable.dispose();
    }

    disposables = [];
    clearDecorations();
}

// ---------------------------------------------------------------------------
// 커맨드
// ---------------------------------------------------------------------------

/** 빠른 선택에 쓰는 설명. 종류 이름과 대표 색을 함께 보여 준다. */
const TYPE_DESCRIPTIONS: Record<DecoType, string> = {
    Typo: '맞춤법·오탈자',
    Grammar: '문법 오류',
    Logical: '논리 오류',
    Other: '기타 의견',
    Highlight: '강조'
};

/**
 * 에디터 컨텍스트 메뉴(`editor/context`)에서 데코레이션을 추가한다(§15.6).
 * 선택 영역이 없으면 커서 자리에 1글자짜리 데코레이션이 붙는다.
 */
export async function addDecorationCommand(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return;
    }

    const open = getOpenDocByUri(editor.document.uri);
    if (!open) {
        void vscode.window.showWarningMessage('Axis Share: 우리 저장소 사본에서만 리뷰를 남길 수 있습니다.');
        return;
    }

    if (!open.attached || !open.canWrite) {
        void vscode.window.showWarningMessage('Axis Share: 연결이 끊겼거나 이 브랜치에 쓰기 권한이 없습니다.');
        return;
    }

    const picked = await vscode.window.showQuickPick(
        DECO_TYPES.map((type) => ({
            label: `${decoLabel(type)} (${type})`,
            description: TYPE_DESCRIPTIONS[type],
            type
        })),
        { placeHolder: '리뷰 종류를 선택하세요' }
    );
    if (!picked) {
        return;
    }

    const memo = await vscode.window.showInputBox({
        prompt: '리뷰 메모를 입력하세요 (비워 두어도 됩니다)',
        placeHolder: '예: 이 조건은 반대 아닌가요?'
    });
    if (memo === undefined) {
        return; // 사용자가 취소했다.
    }

    const session = getSession();
    if (!session) {
        return;
    }

    const document = editor.document;
    const raw = document.getText();
    // 버퍼가 Yjs 를 앞서면 오프셋이 문서 끝으로 클램프되고, 그 좌표는 나중에 파일 끝에 붙는다.
    // 그런 좌표는 아예 만들지 않는다(§8.10-1).
    if (normalizeEol(raw) !== open.text.toString()) {
        void vscode.window.showWarningMessage('Axis Share: 편집 내용이 동기화될 때까지 잠시 뒤에 다시 시도해 주세요.');
        return;
    }

    const selection = editor.selection;
    const start = toNormalizedOffset(raw, document.offsetAt(selection.start));
    const end = toNormalizedOffset(raw, document.offsetAt(selection.end));
    if (start > open.text.length || end > open.text.length) {
        void vscode.window.showWarningMessage('Axis Share: 선택 영역이 아직 동기화되지 않았습니다.');
        return;
    }

    const decoration: Decoration = {
        id: newDecorationId(),
        path: open.path,
        decoType: picked.type,
        memo: memo.trim(),
        userEmail: session.userEmail,
        userName: session.userName,
        createdAt: new Date().toISOString(),
        line: selection.start.line,
        startRel: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(open.text, start)),
        endRel: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(open.text, end))
    };

    const sent = sendDecorationFrame(open.path, {
        id: decoration.id,
        decoType: decoration.decoType,
        memo: decoration.memo,
        line: decoration.line ?? 0,
        startRel: decoration.startRel,
        endRel: decoration.endRel
    });
    if (!sent) {
        void vscode.window.showWarningMessage('Axis Share: 협업 서버에 연결되어 있지 않아 리뷰를 저장하지 못했습니다.');
        return;
    }

    // 서버는 발신자에게 되돌려 주지 않는다 — 화면에 바로 보이게 여기서 먼저 반영한다(낙관적 갱신).
    upsertRecord(decoration);
}

/** 사이드바에서 리뷰를 눌렀을 때 그 자리로 이동한다(§15.6 이동 = 레퍼런스 `jumpToDecoration`). */
export async function jumpToDecorationCommand(item?: unknown): Promise<void> {
    const decoration = toDecorationArg(item);
    if (!decoration) {
        return;
    }

    await openRepoFile({ path: decoration.path });

    const editor = visibleEditorFor(decoration.path);
    if (!editor) {
        return;
    }

    const document = editor.document;
    const open = getOpenDocByUri(document.uri);
    const raw = open ? synchronizedText(open, document) : undefined;
    const range =
        open && raw !== undefined ? resolveDecorationRange(open, document, raw, decoration) : undefined;
    const line = range?.start.line ?? decorationLine(decoration) ?? 0;
    const position = new vscode.Position(line, range?.start.character ?? 0);

    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

/** 리뷰를 지운다. 삭제는 누구나 가능하다 — 브랜치 쓰기 권한만 본다(§8.10 확정). */
export async function deleteDecorationCommand(item?: unknown): Promise<void> {
    const decoration = toDecorationArg(item);
    if (!decoration) {
        return;
    }

    const confirmed = await vscode.window.showWarningMessage(
        `리뷰 "${memoLabel(decoration)}" 를 삭제할까요?`,
        { modal: true },
        '삭제'
    );
    if (confirmed !== '삭제') {
        return;
    }

    if (!sendDecorationDeleteFrame(decoration.path, decoration.id)) {
        void vscode.window.showWarningMessage('Axis Share: 협업 서버에 연결되어 있지 않아 삭제하지 못했습니다.');
        return;
    }

    removeDecoration(decoration.path, decoration.id);
}

/** 표시 토글(§15.6). 값은 설정에 저장되므로 창을 다시 열어도 유지된다. */
export async function toggleDecorationsCommand(): Promise<void> {
    const next = !decorationsVisible();
    await vscode.workspace
        .getConfiguration('axis-share')
        .update('showDecorations', next, vscode.ConfigurationTarget.Global);
    await syncVisibilityContext();
}

/** 트리에서 넘어온 항목(또는 데코레이션 자체)을 데코레이션으로 좁힌다. */
function toDecorationArg(item: unknown): Decoration | undefined {
    if (!item || typeof item !== 'object') {
        return undefined;
    }

    const candidate = item as Record<string, unknown>;
    const path = typeof candidate.path === 'string' ? candidate.path : undefined;
    const id = typeof candidate.id === 'string' ? candidate.id : undefined;
    if (path === undefined || id === undefined) {
        return undefined;
    }

    return findDecoration(path, id);
}

/** 우리 로컬 사본을 띄운 에디터. 열자마자 찾아야 하므로 화면에 보이는 것만 본다. */
function visibleEditorFor(path: string): vscode.TextEditor | undefined {
    return vscode.window.visibleTextEditors.find((editor) => getOpenDocByUri(editor.document.uri)?.path === path);
}

/** 데코레이션 id. 서버가 만든 값과 겹치지 않게 시각·난수를 섞는다(브랜치 단위로만 유일하면 된다). */
function newDecorationId(): string {
    const random = Math.floor(Math.random() * 0xffffffff)
        .toString(16)
        .padStart(8, '0');
    return `d${Date.now().toString(36)}${random}`;
}