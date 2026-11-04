import * as vscode from 'vscode';

import {
    DECO_TYPES,
    decorationsForPath,
    decorationsVisible,
    decoLabel,
    decoTextDecoration,
    decoWashHex,
    decoColorHex,
    authorLabel,
    formatTimestamp,
    onDidChangeDecorations,
    resolveDecorationRange,
    synchronizedText,
    type DecoType,
    type Decoration
} from './decorations';
import { getOpenDocByUri, listOpenDocs, type OpenDoc } from './docSocket';

/**
 * [TASK_11 §8.10 / §15.6] 리뷰 데코레이션 인라인 렌더러.
 *
 * 목록은 decorations.ts 가 들고 있고(서버 프레임으로 채워진다), 여기서는 **그리는 일만** 한다.
 * 좌표는 상대 좌표라 각자의 `Y.Doc` 에서만 풀 수 있으므로(§8.10), 해석도 여기서 한다.
 *
 * 지키는 계약(값비싼 교훈 — §8.10):
 *   1. 버퍼가 Yjs 를 앞서면(오프셋이 문서 끝으로 클램프될 상황) **그리지 않는다** — 직전 그림을 남긴다.
 *      커서가 파일 끝으로 튀는 것과 같은 이유다.
 *   2. 앵커가 사라진 데코레이션은 건너뛴다 — 문서가 그 자리를 지웠다는 뜻이다.
 *   3. 줄 번호가 아니라 **상대 좌표**로 그린다. 그래서 위에서 글을 넣으면 데코레이션도 따라 내려간다.
 *   4. 화면 밖(가시 범위 ± 버퍼)은 그리지 않는다 — 큰 파일에서 비용이 줄의 수에 비례하지 않게 한다.
 *   5. 다시 그리는 일은 묶는다(편집 200ms, 스크롤 40ms). 타이핑마다 전부 다시 그리면 버벅인다.
 */

/** 편집 후 위치 재계산 디바운스(ms). 레퍼런스와 같은 값이다. */
const RECALC_DEBOUNCE_MS = 200;

/** 스크롤(가시 범위 변경) 후 다시 그리는 디바운스(ms). */
const SCROLL_DEBOUNCE_MS = 40;

/** 가시 범위 위아래로 더 그리는 여유 줄 수. 레퍼런스와 같은 값이다. */
const OVERSCAN_LINES = 50;

class DecorationRenderer implements vscode.Disposable {
    /** 종류별 데코레이션 타입. 색이 바뀌면(테마 전환) 버리고 다시 만든다. */
    private readonly types = new Map<DecoType, vscode.TextEditorDecorationType>();

    /** 경로별 다시 그리기 타이머. */
    private readonly renderTimers = new Map<string, ReturnType<typeof setTimeout>>();

    private readonly disposables: vscode.Disposable[] = [];

    private scrollTimer: ReturnType<typeof setTimeout> | undefined;
    private disposed = false;

    public constructor() {
        this.disposables.push(
            // 목록이 바뀌면(내가 추가·삭제, 남의 변경) 전부 다시 그린다.
            onDidChangeDecorations(() => this.renderAll()),
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                if (editor) {
                    this.schedule(editor.document.uri);
                }
            }),
            // 로컬 편집으로 Yjs 가 움직이면 상대 좌표의 화면 위치도 움직인다 — 다시 푼다.
            vscode.workspace.onDidChangeTextDocument((event) => {
                if (getOpenDocByUri(event.document.uri)) {
                    this.schedule(event.document.uri);
                }
            }),
            // 스크롤이나 탭 분할로 가시 범위가 바뀌면 새로 보이는 구간을 그려야 한다.
            vscode.window.onDidChangeTextEditorVisibleRanges(() => this.onVisibleRangesChanged()),
            vscode.window.onDidChangeVisibleTextEditors(() => this.onVisibleRangesChanged()),
            // 테마가 바뀌면 골라 둔 hex 색이 낡는다 — 타입을 버리고 다시 그린다.
            vscode.window.onDidChangeActiveColorTheme(() => this.onThemeChanged()),
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration('axis-share.showDecorations')) {
                    this.renderAll();
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

        if (this.scrollTimer) {
            clearTimeout(this.scrollTimer);
            this.scrollTimer = undefined;
        }

        this.disposeTypes();

        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables.length = 0;
    }

    // -----------------------------------------------------------------------
    // 다시 그리기 예약
    // -----------------------------------------------------------------------

    /** 한 파일의 편집이 몰려도 한 번만 다시 그린다(§15.6, 레퍼런스 200ms). */
    private schedule(uri: vscode.Uri): void {
        if (this.disposed) {
            return;
        }

        const open = getOpenDocByUri(uri);
        if (!open) {
            return; // 우리 로컬 사본이 아니다.
        }

        const key = open.path;
        const existing = this.renderTimers.get(key);
        if (existing) {
            clearTimeout(existing);
        }

        const timer = setTimeout(() => {
            this.renderTimers.delete(key);
            this.renderPath(key);
        }, RECALC_DEBOUNCE_MS);
        this.renderTimers.set(key, timer);
    }

    /** 가시 범위 변경은 자주 온다 — 묶어서 한 번만 다시 그린다. */
    private onVisibleRangesChanged(): void {
        if (this.disposed || this.scrollTimer) {
            return;
        }

        this.scrollTimer = setTimeout(() => {
            this.scrollTimer = undefined;
            this.renderAll();
        }, SCROLL_DEBOUNCE_MS);
    }

    private onThemeChanged(): void {
        this.disposeTypes();
        this.renderAll();
    }

    private renderAll(): void {
        for (const open of listOpenDocs()) {
            this.renderPath(open.path);
        }
    }

    // -----------------------------------------------------------------------
    // 그리기
    // -----------------------------------------------------------------------

    /** 한 파일의 데코레이션을 화면에 그린다. 안 보이는 탭이면 아무것도 하지 않는다. */
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
            return; // 화면에 없는 탭이다 — 다시 앞으로 오면 그때 그린다.
        }

        const show = decorationsVisible();
        const decorations = show ? decorationsForPath(path) : [];
        const raw = decorations.length > 0 ? synchronizedText(open, document) : undefined;

        // 버퍼가 Yjs 를 앞서면 이번 렌더를 건너뛴다(§8.10-1·3). 이미 그려 둔 좌표가 그대로 남는다.
        if (decorations.length > 0 && raw === undefined) {
            return;
        }

        for (const editor of editors) {
            const byType = this.collectOptions(open, document, raw, editor, decorations);
            for (const type of DECO_TYPES) {
                editor.setDecorations(this.typeFor(type), byType.get(type) ?? []);
            }
        }
    }

    /** 한 에디터에 그릴 데코레이션을 종류별로 모은다. 앵커가 사라진 것은 건너뛴다. */
    private collectOptions(
        open: OpenDoc,
        document: vscode.TextDocument,
        raw: string | undefined,
        editor: vscode.TextEditor,
        decorations: readonly Decoration[]
    ): Map<DecoType, vscode.DecorationOptions[]> {
        const byType = new Map<DecoType, vscode.DecorationOptions[]>();

        // 표시 토글이 꺼졌거나 그릴 것이 없으면 빈 목록을 돌려준다 — 이전 그림을 지운다.
        if (raw === undefined) {
            return byType;
        }

        for (const decoration of decorations) {
            const range = resolveDecorationRange(open, document, raw, decoration);
            if (!range) {
                continue; // 문서가 그 자리를 지웠다.
            }

            if (!isNearVisible(editor, range)) {
                continue; // 화면 밖 — 다음 스크롤에서 그린다.
            }

            const list = byType.get(decoration.decoType);
            const option: vscode.DecorationOptions = { range, hoverMessage: hoverFor(decoration) };
            if (list) {
                list.push(option);
            } else {
                byType.set(decoration.decoType, [option]);
            }
        }

        return byType;
    }

    /**
     * 종류별 데코레이션 타입. 색은 등록 색 id 가 아니라 hex 로 넣는다 —
     * 확장이 등록한 색 id 는 데코레이션에서 해석되지 않는다(userColors.ts 의 2026-10-09 관찰과 같다).
     */
    private typeFor(type: DecoType): vscode.TextEditorDecorationType {
        const cached = this.types.get(type);
        if (cached) {
            return cached;
        }

        const created = vscode.window.createTextEditorDecorationType({
            backgroundColor: decoWashHex(type),
            textDecoration: decoTextDecoration(type),
            overviewRulerColor: decoColorHex(type),
            overviewRulerLane: vscode.OverviewRulerLane.Right
        });
        this.types.set(type, created);
        return created;
    }

    private disposeTypes(): void {
        for (const type of this.types.values()) {
            type.dispose();
        }

        this.types.clear();
    }
}

/** 가시 범위 위아래 `OVERSCAN_LINES` 안에 걸리는가(§15.6 — 화면 밖은 그리지 않는다). */
function isNearVisible(editor: vscode.TextEditor, range: vscode.Range): boolean {
    const ranges = editor.visibleRanges;
    if (ranges.length === 0) {
        return true; // 가시 범위를 모를 때는 전부 그린다 — 안 그리면 아무것도 안 보인다.
    }

    return ranges.some((visible) => {
        const from = Math.max(0, visible.start.line - OVERSCAN_LINES);
        const to = visible.end.line + OVERSCAN_LINES;
        return range.end.line >= from && range.start.line <= to;
    });
}

/** 마우스를 올리면 보이는 툴팁. 메모·작성자·시각과 삭제 링크를 담는다(§15.6). */
function hoverFor(decoration: Decoration): vscode.MarkdownString {
    const markdown = new vscode.MarkdownString();
    markdown.isTrusted = true;
    markdown.supportThemeIcons = true;

    markdown.appendMarkdown(`**${decoLabel(decoration.decoType)}** · ${escapeMarkdown(authorLabel(decoration))}\n\n`);

    const memo = decoration.memo.trim();
    if (memo !== '') {
        markdown.appendMarkdown(`${escapeMarkdown(memo)}\n\n`);
    }

    const when = formatTimestamp(decoration.createdAt);
    if (when) {
        markdown.appendMarkdown(`_${escapeMarkdown(when)}_\n\n`);
    }

    // 삭제는 누구나 할 수 있다(§8.10 확정). 링크 하나로 지울 수 있게 둔다.
    const command = vscode.Uri.parse(
        `command:axis-share.deleteDecoration?${encodeURIComponent(JSON.stringify([decoration]))}`
    );
    markdown.appendMarkdown(`[$(trash) 삭제](${command})`);

    return markdown;
}

/** 툴팁이 메모의 마크다운 기호에 휘둘리지 않게 최소한만 이스케이프한다. */
function escapeMarkdown(text: string): string {
    return text.replace(/[\\`*_{}[\]()#+\-.!|]/g, (match) => `\\${match}`);
}

/** 우리 로컬 사본을 띄운 문서. 화면에 없어도(백그라운드 탭) 버퍼는 살아 있다. */
function findDocument(uri: vscode.Uri): vscode.TextDocument | undefined {
    const key = uri.toString();
    return vscode.workspace.textDocuments.find((document) => document.uri.toString() === key);
}

let renderer: DecorationRenderer | undefined;

/** 리뷰 데코레이션 렌더러를 켠다. `extension.ts` activate 에서 한 번 부른다. */
export function startDecorationRenderer(context: vscode.ExtensionContext): void {
    if (renderer) {
        return;
    }

    renderer = new DecorationRenderer();
    context.subscriptions.push(renderer);
}

/** 렌더러를 끄고 그려 둔 데코레이션을 모두 지운다(확장 종료). */
export function stopDecorationRenderer(): void {
    renderer?.dispose();
    renderer = undefined;
}