import * as vscode from 'vscode';

import { ApiError, apiRequest } from '../api';
import { ensureDocSession } from './docSocket';
import { getCurrentBranch, getSession, onDidChangeSession } from './repoSession';
import { lookupStatus, onDidChangeCommitList, onDidChangeIndex, type RepoStatusEntry } from './repoStatus';
import { branchSlug } from './repoTreeProvider';

/**
 * [TASK_11 §15.15] diff 의 **왼쪽(옛 내용)** 공급자 + diff 열기.
 *
 * diff 는 서버가 "합쳐진 diff 텍스트"를 주는 방식이 아니다. 양쪽 **내용**을 각각 문서로 열고
 * VS Code 내장 diff 에디터(`vscode.diff`)에 넘긴다 — 그래서 서버는 파일 내용만 주면 되고,
 * 렌더링(줄 맞춤·색·이동)은 전부 VS Code 가 한다(내장 git 확장과 같은 방식).
 *
 *   왼쪽   `axis-share-ref://...`  이 모듈이 공급한다(HEAD 커밋 내용 / 인덱스 내용 / 빈 문서)
 *   오른쪽 `file://.../globalStorage/repo-<id>/branch-<slug>/<path>`  문서 소켓이 물린 로컬 사본
 *
 * **오른쪽이 로컬 사본이라는 점이 실시간 반영의 근거다.** 그 문서는 이미 문서 소켓에 물려 있어
 * 다른 사용자의 편집이 버퍼에 적용되고, 버퍼가 바뀌면 내장 diff 가 스스로 다시 그린다. 왼쪽은
 * 커밋(HEAD 이동)이나 스테이징(인덱스 변경)으로만 바뀌므로 그 신호에만 다시 받는다.
 *
 * 커밋 사이(4번: 부모 ↔ 커밋)와 push 전(5번: origin/<branch> ↔ HEAD)은 양쪽 다 커밋된 내용이라
 * 실시간 반영 대상이 아니다 — 두 쪽 모두 이 스킴의 문서로 열고, 서버에는 `ref=<rev>` 로 그 버전의
 * 파일 내용만 요청한다(§15.15). Graph 뷰가 바뀐 파일 목록(§3.2 /repos/diff)을 먼저 받아 항목마다 연다.
 *
 * 지키는 규칙 둘(§15.15):
 *   1. 인덱스를 읽을 때 **flush 하지 않는다.** "스테이징 이후 무엇을 더 바꿨나"를 보려면 스테이징
 *      시점 내용이 그대로 남아 있어야 한다 — stage API 가 flush 뒤 `git add` 하는 것과 반대다.
 *   2. 그 버전에 파일이 없으면(HEAD 에 없는 새 파일 / 인덱스에 없는 파일) **빈 문서**로 본다.
 *      git 과 같은 뜻이고, 그래서 "전부 추가 / 전부 삭제"로 보인다.
 */

export const REF_SCHEME = 'axis-share-ref';

/** 자주 쓰는 예약 버전. `none` 은 "그 버전에 이 파일이 없다" 는 뜻이다(§15.15). */
export type RefKind = 'head' | 'index' | 'none';

/**
 * diff 의 한쪽으로 쓸 수 있는 값(§15.15) — 예약어 셋(`head`/`index`/`none`), 임의 rev
 * (`<sha>`, `origin/<branch>` — 4·5번), 그리고 `worktree`(편집 세션이 물린 로컬 사본)다.
 */
export type DiffSide = string;

/** 파일 내용 1건(§3.2 `GET /api/github/repos/file`). diff 왼쪽이 쓰는 필드만 본다. */
type FileRow = { content?: unknown; read_only?: unknown; reason?: unknown };

/**
 * diff 문서의 가상 URI. 저장소 트리(`repoResourceUri`)와 같은 모양에 버전 자리를 하나 끼운다.
 * 버전 자리에는 임의 rev(`origin/<branch>`)도 오므로 **한 조각으로 인코딩**한다(§15.15).
 */
export function refUri(repoId: number, branch: string, ref: string, path: string): vscode.Uri {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const encodedRef = encodeURIComponent(ref);
    return vscode.Uri.parse(`${REF_SCHEME}://${repoId}/${branchSlug(branch)}/${encodedRef}/${encodedPath}`);
}

type RefTarget = { repoId: number; slug: string; ref: string; path: string };

/** 가상 URI 를 되짚는다. 우리가 만든 모양이 아니면 undefined. */
function parseRefUri(uri: vscode.Uri): RefTarget | undefined {
    if (uri.scheme !== REF_SCHEME) {
        return undefined;
    }

    const segments = uri.path.replace(/^\//, '').split('/');
    const slug = segments[0] ?? '';

    // 예약어(head/index/none)와 임의 rev 가 같은 자리를 쓴다 — 인코딩은 refUri 한 곳에서만 한다.
    let ref: string;
    try {
        ref = decodeURIComponent(segments[1] ?? '');
    } catch {
        return undefined; // 잘못된 퍼센트 인코딩
    }
    if (ref.length === 0) {
        return undefined;
    }

    const repoId = Number.parseInt(uri.authority, 10);
    if (!Number.isInteger(repoId)) {
        return undefined;
    }

    const path = segments.slice(2).map(decodeURIComponent).join('/');
    if (slug.length === 0 || path.length === 0) {
        return undefined;
    }

    return { repoId, slug, ref, path };
}

class RefContentProvider implements vscode.TextDocumentContentProvider, vscode.Disposable {
    private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri>();

    public readonly onDidChange = this.changeEmitter.event;

    /** VS Code 가 지금 들고 있는 이 스킴의 문서. 버전이 바뀌면 이 URI 만 무효화한다(§15.15). */
    private readonly open = new Set<string>();

    /** 마지막으로 띄운 오류 문구. 같은 오류로 알림이 반복되지 않게 한다. */
    private lastError: string | undefined;

    public async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
        const target = parseRefUri(uri);
        if (!target) {
            return '';
        }

        this.open.add(uri.toString());
        if (target.ref === 'none') {
            return '';
        }

        const session = getSession();
        const branch = getCurrentBranch();
        // 저장소·브랜치가 바뀌면 이 URI 의 뜻이 달라진다 — 빈 문서로 둔다(§15.15).
        if (!session || !branch || session.repoId !== target.repoId || branchSlug(branch) !== target.slug) {
            return '';
        }

        let query =
            `/github/repos/file?repo_id=${session.repoId}&branch=${encodeURIComponent(branch)}` +
            `&path=${encodeURIComponent(target.path)}`;
        if (target.ref !== 'head') {
            // index 는 그대로, 그 밖에는 임의 rev(`<sha>`, `origin/<branch>`)가 그대로 간다(§15.15).
            query += `&ref=${encodeURIComponent(target.ref)}`;
        }

        try {
            const rows = await apiRequest<FileRow[]>(query);
            const row = Array.isArray(rows) ? rows[0] : undefined;
            if (row?.read_only === true) {
                // 상한 초과·바이너리는 diff 로 그릴 수 없다(§12.6). 빈 문서로 두고 로그만 남긴다.
                log(`diff 왼쪽을 그릴 수 없습니다(${target.path}): ${String(row.reason ?? 'read_only')}`);
                return '';
            }

            return typeof row?.content === 'string' ? row.content : '';
        } catch (error) {
            if (error instanceof ApiError && error.status === 404) {
                return ''; // 그 버전에 파일이 없다 — 전부 추가 / 전부 삭제로 보이는 게 맞다.
            }

            const message = describe(error);
            if (message !== this.lastError) {
                this.lastError = message;
                void vscode.window.showWarningMessage(`Axis Share: 이전 버전을 불러오지 못했습니다. ${message}`);
            }

            return '';
        }
    }

    /** 한 버전이 바뀌었다 — 그 버전을 쓰는 열린 문서만 다시 받게 한다(§15.15). */
    public invalidate(ref: RefKind): void {
        for (const key of this.open) {
            const uri = vscode.Uri.parse(key);
            if (parseRefUri(uri)?.ref === ref) {
                this.changeEmitter.fire(uri);
            }
        }
    }

    /** 세션·브랜치가 바뀌었다 — 이전 브랜치의 왼쪽은 전부 뜻이 없다. */
    public invalidateAll(): void {
        for (const key of this.open) {
            this.changeEmitter.fire(vscode.Uri.parse(key));
        }
    }

    public forget(uri: vscode.Uri): void {
        this.open.delete(uri.toString());
    }

    public dispose(): void {
        this.changeEmitter.dispose();
    }
}

let provider: RefContentProvider | undefined;

/** diff 왼쪽 공급자를 등록한다(§15.2, §15.15). */
export function createRefContentProvider(context: vscode.ExtensionContext): void {
    provider = new RefContentProvider();

    context.subscriptions.push(
        provider,
        vscode.workspace.registerTextDocumentContentProvider(REF_SCHEME, provider),
        // 문서가 닫히면 무효화 대상에서도 뺀다 — 안 그러면 오래된 URI 가 계속 쌓인다.
        vscode.workspace.onDidCloseTextDocument((document) => provider?.forget(document.uri)),
        // HEAD 는 커밋·push 로, 인덱스는 스테이징·해제·되돌리기로 바뀐다(§15.10, §15.15).
        onDidChangeCommitList(() => provider?.invalidate('head')),
        onDidChangeIndex(() => provider?.invalidate('index')),
        onDidChangeSession(() => provider?.invalidateAll())
    );
}

const NO_SESSION_MESSAGE = 'Axis Share: 앱에서 저장소를 연결한 뒤에 볼 수 있습니다.';

/**
 * 한쪽 문서의 URI(§15.15). `worktree` 만 실제 파일이라 그 파일의 편집 세션을 **먼저 물린다** —
 * 그래야 다른 사용자의 편집이 그대로 반영된다(소켓이 버퍼를 고치고 → 내장 diff 가 다시 그린다).
 * 나머지는 이 모듈이 공급하는 가상 문서다.
 */
async function sideUri(repoId: number, branch: string, ref: DiffSide, path: string): Promise<vscode.Uri | undefined> {
    if (ref !== 'worktree') {
        return refUri(repoId, branch, ref, path);
    }

    return ensureDocSession(path);
}

/**
 * 두 버전을 나란히 연다(§15.15). 왼쪽 경로를 따로 받는 이유는 이름변경이다 — 부모 쪽 경로(`from`)와
 * 커밋 쪽 경로(`path`)가 다른데, 둘 다 가상 문서라 실시간 반영 대상이 아니다(4·5번).
 */
export async function openDiff(path: string, left: DiffSide, right: DiffSide, label: string, leftPath?: string): Promise<void> {
    const session = getSession();
    const branch = getCurrentBranch();
    if (!session || !branch) {
        void vscode.window.showWarningMessage(NO_SESSION_MESSAGE);
        return;
    }

    const leftUri = await sideUri(session.repoId, branch, left, leftPath ?? path);
    const rightUri = await sideUri(session.repoId, branch, right, path);
    if (!leftUri || !rightUri) {
        void vscode.window.showWarningMessage(`Axis Share: ${path} 의 비교 내용을 준비하지 못했습니다.`);
        return;
    }

    await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, `${path} (${label})`, {
        preview: true
    });
}

/** Graph 뷰가 넘기는 diff 요청 — 커밋 사이(부모→커밋)나 원격↔HEAD 의 한 파일(§15.15 diff 4·5번). */
export type RangeDiffRequest = {
    /** 왼쪽 버전. 빈 문자열이면 "그 버전에 파일이 없다" — root 커밋의 부모 자리다. */
    base: string;
    /** 오른쪽 버전(`<sha>` 또는 `head`). */
    target: string;
    path: string;
    /** 이름변경의 원본 경로. 왼쪽은 이 경로로 읽는다. */
    oldPath?: string;
    label: string;
};

/** Graph 뷰 파일 항목 클릭 — 커밋 사이/원격 대비 한 파일을 내장 diff 로 연다(§15.15 diff 4·5번). */
export async function openRangeDiff(...args: unknown[]): Promise<void> {
    const request = pickRangeRequest(args);
    if (!request) {
        return;
    }

    const left = request.base.length > 0 ? request.base : 'none';
    await openDiff(request.path, left, request.target, request.label, request.oldPath);
}

/** 커맨드 인자에서 범위 diff 요청 1건을 꺼낸다(Graph 뷰 항목이 객체를 그대로 넘긴다). */
function pickRangeRequest(args: unknown[]): RangeDiffRequest | undefined {
    for (const arg of args) {
        const item = Array.isArray(arg) ? arg[0] : arg;
        if (!isRecord(item)) {
            continue;
        }

        if (typeof item.path === 'string' && typeof item.base === 'string' && typeof item.target === 'string') {
            return {
                base: item.base,
                target: item.target,
                path: item.path,
                oldPath: typeof item.oldPath === 'string' ? item.oldPath : undefined,
                label: typeof item.label === 'string' ? item.label : '변경'
            };
        }
    }

    return undefined;
}

/** Changes 뷰 아이템 클릭 — 그룹이 곧 비교 기준이다(§15.15). */
export async function openItemDiff(args: unknown[]): Promise<void> {
    const entry = pickEntry(args);
    if (!entry) {
        return;
    }

    if (entry.staged) {
        await openDiff(entry.path, 'head', 'index', 'HEAD ↔ 스테이징');
        return;
    }

    // 삭제된 파일은 오른쪽이 빈 문서다 — 작업 트리에 내용이 없다(§15.15).
    await openDiff(entry.path, 'head', entry.state === 'deleted' ? 'none' : 'worktree', 'HEAD ↔ 작업 트리');
}

/** "스테이징 이후 변경 보기" — 스테이징한 뒤에 더 고친 내용을 본다(§15.15). */
export async function openIndexDiff(args: unknown[]): Promise<void> {
    const entry = pickEntry(args);
    if (!entry) {
        return;
    }

    await openDiff(entry.path, 'index', entry.state === 'deleted' ? 'none' : 'worktree', '스테이징 ↔ 작업 트리');
}

/**
 * 커맨드 인자에서 상태 1건을 꺼낸다. 뷰 항목은 `path` 를 그대로 주고, 컨텍스트 메뉴는
 * `resourceUri` 를 줄 수 있어 URI 로도 되짚는다(`repoStatus.collectPaths` 와 같은 규칙, §15.7).
 */
function pickEntry(args: unknown[]): RepoStatusEntry | undefined {
    for (const arg of args) {
        const item = Array.isArray(arg) ? arg[0] : arg;
        if (!isRecord(item)) {
            continue;
        }

        if (typeof item.path === 'string' && item.path.length > 0) {
            return {
                path: item.path,
                state: typeof item.state === 'string' ? item.state : 'modified',
                staged: item.staged === true,
                from: typeof item.from === 'string' ? item.from : undefined
            };
        }

        const uri = item.resourceUri;
        if (uri instanceof vscode.Uri) {
            const found = lookupStatus(uri);
            if (found) {
                return found;
            }
        }
    }

    return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** 확장 호스트 로그. 출력 채널을 붙이게 되면 여기만 바꾸면 된다. */
function log(message: string): void {
    console.log(`[axis-share/diff] ${message}`);
}