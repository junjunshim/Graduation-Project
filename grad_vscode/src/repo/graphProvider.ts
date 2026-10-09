import * as vscode from 'vscode';

import { apiRequest } from '../api';
import type { RangeDiffRequest } from './refContentProvider';
import { getCurrentBranch, getSession, onDidChangeSession } from './repoSession';
import { NO_SESSION_MESSAGE } from './repoTreeProvider';
import { badgeForState, getSyncInfo, labelForState, onDidChangeCommitList, onDidChangeStatus } from './repoStatus';

/**
 * [TASK_11 §15.14] Graph 뷰 — 현재 브랜치의 커밋 현황과 원격 위치.
 *
 * 데이터는 서버 로컬 clone 의 실제 git 이력이다(§3.2 `GET /api/github/repos/commits`).
 * 앱의 GitHub 탭과 같은 엔드포인트를 쓰므로 두 화면의 이력이 어긋나지 않는다.
 *
 * 각 커밋은 `refs`(`git log %D`)를 함께 받는다 — `HEAD -> main`, `origin/main` 이 그 안에 있다.
 * 그래서 "원격(origin/<branch>)이 어디까지 왔는지" 를 커밋 목록 위에서 바로 표시할 수 있다.
 * 앞선/뒤진 개수는 `repoStatus` 가 받아 둔 sync(§3.2 `/repos/sync`)를 그대로 읽는다 — 다시 세지 않는다.
 *
 * 커밋과 push 를 분리했으므로(§12.11) 원격보다 위에 있는 커밋(미push)을 색으로 구분한다.
 *
 * 커밋과 요약을 펼치면 **그 사이에 바뀐 파일**이 나온다(§3.2 `GET /api/github/repos/diff`).
 * 그 파일을 누르면 `axis-share.openRangeDiff` 가 양쪽 버전을 내장 diff 로 연다(§15.15 4·5번).
 * 서버는 파일 목록만 만들고 비교는 VS Code 가 한다 — 내용은 파일 단위 조회로 따로 온다.
 */

const VIEW_GRAPH = 'axis-share-graph';

/** 한 번에 그리는 커밋 수. 서버 상한(200) 안쪽이다. */
const COMMIT_LIMIT = 100;

/** `GET /api/github/repos/commits` 의 항목 1건(§3.2). */
export type GraphCommit = {
    sha: string;
    parents?: string[];
    refs?: string[];
    subject?: string;
    author_name?: string;
    author_email?: string;
    authored_at?: string;
};

/** `GET /api/github/repos/diff` 의 항목 1건 — 두 버전 사이에서 바뀐 파일(§3.2). */
export type RangeFile = {
    path: string;
    /** `added|modified|deleted|renamed|copied|typechange` — status 와 같은 상태 이름(§3.2). */
    state: string;
    /** `renamed` / `copied` 의 원본 경로. 왼쪽 diff 는 이 경로로 읽는다. */
    from?: string;
};

/**
 * 뷰가 그리는 항목. 맨 위 요약 한 줄 + 커밋 목록이고, 커밋과 요약은 펼치면 그 사이에
 * **바뀐 파일**이 나온다(§15.15 diff 4·5번). 그 파일을 누르면 내장 diff 가 열린다.
 */
export type GraphItem =
    | { kind: 'summary' }
    | { kind: 'commit'; commit: GraphCommit; base: string; pushed: boolean; isHead: boolean; isOriginTip: boolean }
    | { kind: 'file'; state: string; request: RangeDiffRequest }
    | { kind: 'note'; text: string };

export class GraphTreeProvider implements vscode.TreeDataProvider<GraphItem>, vscode.Disposable {
    private readonly changeEmitter = new vscode.EventEmitter<void>();

    public readonly onDidChangeTreeData = this.changeEmitter.event;

    private view: vscode.TreeView<GraphItem> | undefined;

    /** 마지막으로 받은 커밋 목록(최신 → 과거). */
    private commits: readonly GraphCommit[] = [];

    private loading = false;

    private lastError: string | undefined;

    /**
     * 펼친 항목의 바뀐 파일 목록. 커밋은 내용이 변하지 않으므로 한 번 받으면 그대로 두고,
     * 원격 대비 목록은 sync 가 바뀌면 키가 달라져 자연히 새로 받는다(그리고 refresh 가 비운다).
     */
    private readonly filesByKey = new Map<string, readonly RangeFile[]>();

    public attachView(view: vscode.TreeView<GraphItem>): void {
        this.view = view;
        this.refresh();
    }

    /** 목록을 다시 받아 온다. 세션이 바뀌거나 커밋·push 가 일어나거나 사용자가 새로 고칠 때 부른다. */
    public refresh(): void {
        this.filesByKey.clear();
        void this.reload();
    }

    /** 이미 받아 둔 목록으로만 다시 그린다. sync(ahead/behind)가 바뀌었을 때 쓴다. */
    public redraw(): void {
        this.updateChrome();
        this.changeEmitter.fire();
    }

    public dispose(): void {
        this.changeEmitter.dispose();
    }

    public getTreeItem(item: GraphItem): vscode.TreeItem {
        switch (item.kind) {
            case 'summary':
                return summaryTreeItem();
            case 'commit':
                return commitTreeItem(item);
            case 'file':
                return fileTreeItem(item);
            default:
                return noteTreeItem(item.text);
        }
    }

    public async getChildren(element?: GraphItem): Promise<GraphItem[]> {
        if (!element) {
            return this.rootItems();
        }

        if (element.kind === 'commit') {
            return this.commitFiles(element);
        }

        if (element.kind === 'summary') {
            return this.remoteFiles();
        }

        return []; // 파일·안내 항목에는 자식이 없다.
    }

    /** 요약 한 줄 + 커밋 목록(최신 → 과거). */
    private rootItems(): GraphItem[] {
        if (this.commits.length === 0) {
            return [];
        }

        const branch = getCurrentBranch() ?? '';
        const originTip = this.commits.findIndex((commit) => refsOf(commit).includes(`origin/${branch}`));

        const items: GraphItem[] = [{ kind: 'summary' }];
        this.commits.forEach((commit, index) => {
            // origin/<branch> 팁보다 위(최신)에 있는 커밋이 아직 push 되지 않은 것이다.
            const pushed = originTip >= 0 && index <= originTip;
            items.push({
                kind: 'commit',
                commit,
                // 부모가 없으면 root 커밋이다 — 왼쪽이 빈 문서가 되어 "전부 추가"로 보인다(§15.15).
                base: commit.parents?.[0] ?? '',
                pushed,
                isHead: refsOf(commit).some((ref) => ref.startsWith('HEAD ->')),
                isOriginTip: index === originTip
            });
        });

        return items;
    }

    /** 커밋을 펼쳤다 — 부모 → 커밋 사이에 바뀐 파일(4번, §15.15). */
    private async commitFiles(item: Extract<GraphItem, { kind: 'commit' }>): Promise<GraphItem[]> {
        const sha = item.commit.sha;
        const label = `${sha.slice(0, 8)} 변경`;

        let files = this.filesByKey.get(sha);
        if (!files) {
            const result = await this.fetchFiles(`commit:${sha}`, item.base, sha);
            if (typeof result === 'string') {
                return [note(`변경 목록을 불러오지 못했습니다: ${result}`)];
            }

            files = result;
            this.filesByKey.set(sha, files);
        }

        return files.length === 0
            ? [note('바뀐 파일이 없습니다.')]
            : files.map((file) => ({ kind: 'file', state: file.state, request: rangeRequest(file, item.base, sha, label) }));
    }

    /**
     * 요약을 펼쳤다 — push 하면 원격에 올라갈 내용(5번, §15.15).
     *
     * 왼쪽은 `origin/<branch>` 그대로가 아니라 sync 가 준 **원격 팁 SHA** 를 쓴다. 가상 URI 의 버전
     * 자리에 `/` 가 들어가면 조각이 갈라져 인코딩이 필요해지는데, SHA 는 그런 문자가 없다. 뜻은 같다 —
     * `git diff origin/<branch> HEAD` 와 `git diff <origin_sha> HEAD` 는 같은 비교다.
     */
    private async remoteFiles(): Promise<GraphItem[]> {
        const branch = getCurrentBranch();
        const sync = getSyncInfo();
        const base = sync.origin_sha ?? '';
        if (!branch || !sync.has_upstream || base.length === 0) {
            return [note('이 브랜치는 아직 원격에 없습니다 — push 로 올리면 비교할 수 있습니다.')];
        }

        if (sync.ahead === 0 && sync.behind === 0) {
            return [note('원격과 차이가 없습니다.')];
        }

        // 원격·HEAD 가 움직이면 키가 달라진다 — refresh(커밋·push 이벤트)가 캐시를 비우기도 한다.
        const key = `${base}:${sync.head_sha ?? ''}`;
        let files = this.filesByKey.get(key);
        if (!files) {
            const result = await this.fetchFiles(key, base, 'head');
            if (typeof result === 'string') {
                return [note(`변경 목록을 불러오지 못했습니다: ${result}`)];
            }

            files = result;
            this.filesByKey.set(key, files);
        }

        const label = `원격 origin/${branch} 대비 변경`;
        return files.length === 0
            ? [note('원격과 차이가 없습니다.')]
            : files.map((file) => ({ kind: 'file', state: file.state, request: rangeRequest(file, base, 'head', label) }));
    }

    /**
     * 두 버전 사이에 바뀐 파일 목록(§3.2 `GET /api/github/repos/diff`). 실패하면 사유 문구를 돌려준다 —
     * 뷰는 그 문구를 안내 줄로 보여 준다(예외를 던져 트리 전체를 깨뜨리지 않는다).
     */
    private async fetchFiles(cacheKey: string, base: string, target: string): Promise<readonly RangeFile[] | string> {
        const session = getSession();
        if (!session) {
            this.filesByKey.delete(cacheKey);
            return NO_SESSION_MESSAGE;
        }

        const query =
            `/github/repos/diff?repo_id=${session.repoId}` +
            `&base=${encodeURIComponent(base)}&target=${encodeURIComponent(target)}`;
        try {
            const rows = await apiRequest<RangeFile[]>(query);
            return Array.isArray(rows) ? rows.filter(isRangeFile) : [];
        } catch (error) {
            return error instanceof Error ? error.message : String(error);
        }
    }

    /** 커밋 목록을 서버에서 받아 온다. */
    private async reload(): Promise<void> {
        const session = getSession();
        const branch = getCurrentBranch();
        if (!session || !branch) {
            this.commits = [];
            this.lastError = undefined;
            this.updateChrome();
            this.changeEmitter.fire();
            return;
        }

        this.loading = true;
        this.updateChrome();
        try {
            const rows = await apiRequest<GraphCommit[]>(
                `/github/repos/commits?repo_id=${session.repoId}&branch=${encodeURIComponent(branch)}&limit=${COMMIT_LIMIT}`
            );
            this.commits = Array.isArray(rows) ? rows.filter(isGraphCommit) : [];
            this.lastError = undefined;
        } catch (error) {
            this.commits = [];
            this.lastError = error instanceof Error ? error.message : String(error);
        } finally {
            this.loading = false;
            this.updateChrome();
            this.changeEmitter.fire();
        }
    }

    /** 뷰 타이틀과 빈 상태·오류 문구를 맞춘다(§15.12). */
    private updateChrome(): void {
        const view = this.view;
        if (!view) {
            return;
        }

        const branch = getCurrentBranch();
        view.description = branch;

        if (!getSession() || !branch) {
            view.message = NO_SESSION_MESSAGE;
            return;
        }

        if (this.loading) {
            view.message = '커밋 기록을 불러오는 중입니다…';
            return;
        }

        if (this.lastError) {
            view.message = `커밋 기록을 불러오지 못했습니다: ${this.lastError}`;
            return;
        }

        view.message = this.commits.length === 0 ? '이 브랜치에는 아직 커밋이 없습니다.' : undefined;
    }
}

/** 요약 한 줄 — 원격 추적 상태와 앞선/뒤진 개수(§3.2 sync). */
function summaryTreeItem(): vscode.TreeItem {
    const sync = getSyncInfo();
    const branch = getCurrentBranch() ?? '';
    const hasUpstream = sync.has_upstream;

    // 원격과 차이가 있을 때만 펼친다 — 펼치면 push 하면 올라갈 파일이 나온다(§15.15 diff 5번).
    const expandable = hasUpstream && (sync.ahead > 0 || sync.behind > 0);
    const node = new vscode.TreeItem(
        hasUpstream ? `origin/${branch}` : '아직 원격에 없음',
        expandable ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
    );
    node.id = 'graph-summary';
    node.description = hasUpstream ? `↑${sync.ahead} ↓${sync.behind}` : `올릴 커밋 ${sync.ahead}개`;
    node.iconPath = new vscode.ThemeIcon(hasUpstream ? 'cloud' : 'cloud-upload');
    node.contextValue = 'axisGraphSummary';

    const lines = hasUpstream
        ? [`원격보다 앞선 커밋: ${sync.ahead}개`, `원격이 앞선 커밋: ${sync.behind}개`]
        : ['이 브랜치는 아직 push 되지 않았습니다.'];
    if (sync.head_sha) {
        lines.push(`HEAD: ${sync.head_sha.slice(0, 8)}`);
    }
    if (sync.origin_sha) {
        lines.push(`원격: ${sync.origin_sha.slice(0, 8)}`);
    }
    node.tooltip = new vscode.MarkdownString(lines.join('  \n'));

    return node;
}

/** 커밋 한 줄. 미push 커밋은 색으로 구분하고, 원격 위치에 표시를 붙인다. */
function commitTreeItem(item: Extract<GraphItem, { kind: 'commit' }>): vscode.TreeItem {
    const commit = item.commit;
    // 펼치면 그 커밋이 바꾼 파일이 나온다(§15.15 diff 4번).
    const node = new vscode.TreeItem(commit.subject?.trim() || '(제목 없음)', vscode.TreeItemCollapsibleState.Collapsed);

    node.id = commit.sha;
    node.contextValue = 'axisGraphCommit';

    const parts = [commit.sha.slice(0, 8)];
    const author = commit.author_name?.trim() || commit.author_email?.trim();
    if (author) {
        parts.push(author);
    }
    const when = relativeDate(commit.authored_at);
    if (when) {
        parts.push(when);
    }
    const branch = getCurrentBranch() ?? '';
    if (item.isOriginTip) {
        parts.push(`원격 origin/${branch}`);
    } else if (!item.pushed) {
        parts.push('미push');
    }
    if (item.isHead) {
        parts.push('HEAD');
    }
    node.description = parts.join(' · ');

    // 미push(원격보다 앞선) 커밋을 눈에 띄게 한다 — 올리면 사라진다(§12.11).
    node.iconPath = item.pushed
        ? new vscode.ThemeIcon('git-commit')
        : new vscode.ThemeIcon('git-commit', new vscode.ThemeColor('charts.green'));

    const tooltip = [`${commit.subject ?? ''}`, `커밋 ${commit.sha}`];
    if (commit.author_name || commit.author_email) {
        tooltip.push(`작성자 ${[commit.author_name, commit.author_email].filter(Boolean).join(' <') + (commit.author_email ? '>' : '')}`);
    }
    if (commit.authored_at) {
        tooltip.push(`시각 ${commit.authored_at}`);
    }
    node.tooltip = new vscode.MarkdownString(tooltip.join('  \n'));

    return node;
}

/** 펼친 목록의 한 파일 → 그 버전 사이를 여는 diff 요청(§15.15). */
function rangeRequest(file: RangeFile, base: string, target: string, label: string): RangeDiffRequest {
    return { base, target, path: file.path, oldPath: file.from, label };
}

/** 뷰가 그리는 안내 줄. 자식이 없는 자리(바뀐 파일 없음·오류)를 채운다. */
function note(text: string): GraphItem {
    return { kind: 'note', text };
}

/** 펼친 범위에서 바뀐 파일 한 줄. 누르면 그 버전 사이의 내장 diff 가 열린다(§15.15 4·5번). */
function fileTreeItem(item: Extract<GraphItem, { kind: 'file' }>): vscode.TreeItem {
    const { dir, name } = splitPath(item.request.path);
    const node = new vscode.TreeItem(name, vscode.TreeItemCollapsibleState.None);

    node.id = `${item.request.base}:${item.request.target}:${item.request.path}`;
    node.description = dir.length > 0 ? `${badgeForState(item.state)} · ${dir}` : badgeForState(item.state);
    node.iconPath = new vscode.ThemeIcon('diff');
    node.contextValue = 'axisGraphFile';
    node.tooltip = new vscode.MarkdownString(
        [item.request.path, labelForState(item.state), `비교 ${item.request.label}`].join('  \n')
    );
    node.command = {
        command: 'axis-share.openRangeDiff',
        title: '변경 내용 보기',
        arguments: [item.request]
    };

    return node;
}

/** 안내 줄. 눌러도 아무 일도 일어나지 않아야 하므로 command 를 붙이지 않는다. */
function noteTreeItem(text: string): vscode.TreeItem {
    const node = new vscode.TreeItem(text, vscode.TreeItemCollapsibleState.None);
    node.iconPath = new vscode.ThemeIcon('info');
    node.contextValue = 'axisGraphNote';
    return node;
}

/** 경로를 마지막 '/' 에서 나눈다 — 탐색기처럼 파일명을 앞에, 디렉터리를 뒤에 둔다. */
function splitPath(path: string): { dir: string; name: string } {
    const slash = path.lastIndexOf('/');
    return slash < 0 ? { dir: '', name: path } : { dir: path.slice(0, slash), name: path.slice(slash + 1) };
}

function isRangeFile(value: unknown): value is RangeFile {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as { path?: unknown }).path === 'string' &&
        typeof (value as { state?: unknown }).state === 'string'
    );
}

function refsOf(commit: GraphCommit): readonly string[] {
    return Array.isArray(commit.refs) ? commit.refs : [];
}

/** ISO 작성 시각을 "3시간 전" 같은 짧은 문구로 바꾼다. 파싱 실패면 원문을 그대로 둔다. */
function relativeDate(value: string | undefined): string {
    if (!value) {
        return '';
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return value;
    }

    const minutes = Math.floor((Date.now() - parsed.getTime()) / 60_000);
    if (minutes < 1) {
        return '방금';
    }
    if (minutes < 60) {
        return `${minutes}분 전`;
    }

    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
        return `${hours}시간 전`;
    }

    const days = Math.floor(hours / 24);
    if (days < 30) {
        return `${days}일 전`;
    }

    return parsed.toLocaleDateString('ko-KR');
}

function isGraphCommit(value: unknown): value is GraphCommit {
    return typeof value === 'object' && value !== null && typeof (value as { sha?: unknown }).sha === 'string';
}

/**
 * Graph 뷰를 만들고 등록한다(§15.2, §15.14).
 * 세션이 바뀌면 목록을 다시 받고, 상태(sync)가 바뀌면 받아 둔 목록으로만 다시 그린다.
 * 탭이 보일 때 한 번 더 받아 온다 — 다른 사용자가 방금 커밋한 내용을 열자마자 보게 하려는 것이다.
 */
export function createGraphView(context: vscode.ExtensionContext): {
    view: vscode.TreeView<GraphItem>;
    provider: GraphTreeProvider;
} {
    const provider = new GraphTreeProvider();
    const view = vscode.window.createTreeView(VIEW_GRAPH, {
        treeDataProvider: provider
    });

    provider.attachView(view);

    context.subscriptions.push(
        view,
        provider,
        onDidChangeSession(() => provider.refresh()),
        onDidChangeStatus(() => provider.redraw()),
        // 커밋·push 는 이력을 바꾼다 — 목록·원격 위치를 다시 받는다(§15.14). 상태 변경(redraw)과 다르다.
        onDidChangeCommitList(() => provider.refresh()),
        view.onDidChangeVisibility((event) => {
            if (event.visible) {
                provider.refresh();
            }
        })
    );

    return { view, provider };
}