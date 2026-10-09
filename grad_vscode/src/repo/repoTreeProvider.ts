import * as vscode from 'vscode';

import { apiRequest } from '../api';
import { getCurrentBranch, getSession, onDidChangeSession } from './repoSession';

/**
 * [TASK_11 §15.3] Repository(파일 트리) 뷰 — 탐색기와 같은 3계층.
 *
 * 컨테이너 = 저장소, 최상위 = 저장소 루트의 한 단계, 그 아래 = 디렉터리/파일.
 * 트리는 **디렉터리 단위 lazy 조회**다(§12.3). 큰 저장소에서 전체 트리를 한 번에 받지 않도록
 * 사용자가 디렉터리를 펼칠 때 그 한 단계만 요청하고, 받은 결과를 브랜치별로 캐시한다.
 */

const VIEW_FILES = 'axis-share-files';

/** 트리 아이템의 가상 URI 스킴(§15.3). git 상태 배지(FileDecorationProvider)가 이 URI 로 붙는다. */
export const REPO_TREE_SCHEME = 'axis-share-repo';

/** 세션이 없을 때 뷰가 보여 주는 안내 문구(§15.12). 다른 뷰도 이 문구를 쓴다. */
export const NO_SESSION_MESSAGE = '앱에서 저장소를 연결하고 "VSCode 로 실시간 편집" 을 눌러 주세요.';

export type RepoTreeEntryType = 'dir' | 'file' | 'submodule';

/** GET /api/github/repos/tree 응답 항목(§3.2). 요청한 경로의 한 단계만 온다. */
export type RepoTreeEntry = {
    name: string;
    path: string;
    type: RepoTreeEntryType;
    size?: number;
};

/**
 * 브랜치 이름 → 경로 슬러그(§2.3). 브랜치마다 로컬 작업 사본 디렉터리를 나누는 규칙이라
 * 서버·확장이 같은 값을 써야 한다. 브랜치 이름의 '/' 만 '__' 로 바꾼다.
 */
export function branchSlug(branch: string): string {
    return branch.replace(/\//g, '__');
}

function iconFor(type: RepoTreeEntryType): string {
    if (type === 'dir') {
        return 'folder';
    }

    return type === 'submodule' ? 'file-submodule' : 'file';
}

/** 탐색기처럼 디렉터리를 먼저, 같은 종류끼리는 이름순으로 보여 준다. */
function sortEntries(entries: RepoTreeEntry[]): RepoTreeEntry[] {
    return entries.sort((a, b) => {
        const rankA = a.type === 'dir' ? 0 : 1;
        const rankB = b.type === 'dir' ? 0 : 1;
        return rankA !== rankB ? rankA - rankB : a.name.localeCompare(b.name);
    });
}

function formatSize(bytes: number | undefined): string | undefined {
    if (typeof bytes !== 'number' || bytes < 0) {
        return undefined;
    }

    if (bytes < 1024) {
        return `${bytes} B`;
    }

    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(1)} KB`;
    }

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export class RepoTreeProvider implements vscode.TreeDataProvider<RepoTreeEntry> {
    private readonly changeEmitter = new vscode.EventEmitter<void>();
    public readonly onDidChangeTreeData = this.changeEmitter.event;

    /** 디렉터리별 조회 결과 캐시. 키는 `branch|path` — 브랜치가 바뀌면 통째로 버린다(§12.3). */
    private readonly cache = new Map<string, RepoTreeEntry[]>();

    /** 뷰에 띄울 안내 문구. 세션 없음이면 연결 안내, 조회 실패면 사유(§15.12). */
    private message: string | undefined = NO_SESSION_MESSAGE;

    private view: vscode.TreeView<RepoTreeEntry> | undefined;

    public getTreeItem(entry: RepoTreeEntry): vscode.TreeItem {
        const isDir = entry.type === 'dir';
        const item = new vscode.TreeItem(
            entry.name,
            isDir ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
        );

        item.iconPath = new vscode.ThemeIcon(iconFor(entry.type));
        item.contextValue = isDir ? 'axisDir' : 'axisFile';

        if (!isDir) {
            // 탐색기처럼 한 번 클릭으로 연다. 내용은 collab 의 open/opened 로만 받는다(§12.4).
            item.command = { command: 'axis-share.openFile', title: '열기', arguments: [entry] };
        }

        const size = formatSize(entry.size);
        item.tooltip = size ? `${entry.path} · ${size}` : entry.path;

        const session = getSession();
        const branch = getCurrentBranch();
        if (session && branch) {
            // 배지·열기 대상이 globalStorage 의 실제 경로 규칙에 의존하지 않도록 가상 URI 를 준다(§15.3).
            item.id = `${branch}|${entry.path}`;
            item.resourceUri = repoResourceUri(session.repoId, branch, entry.path);
        } else {
            item.id = entry.path;
        }

        return item;
    }

    public async getChildren(parent?: RepoTreeEntry): Promise<RepoTreeEntry[]> {
        const session = getSession();
        const branch = getCurrentBranch();
        if (!session || !branch) {
            return [];
        }

        const path = parent?.path ?? '';
        const key = `${branch}|${path}`;
        const cached = this.cache.get(key);
        if (cached) {
            return cached;
        }

        try {
            const entries = await apiRequest<RepoTreeEntry[]>(
                `/github/repos/tree?repo_id=${session.repoId}` +
                    `&branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}`
            );
            const list = sortEntries(Array.isArray(entries) ? entries : []);
            this.cache.set(key, list);
            this.setMessage(undefined);
            return list;
        } catch (error) {
            // 오류로 뷰를 죽이지 않는다 — 트리를 비우고 사유만 남긴다(§15.12).
            this.setMessage(
                `저장소 구조를 불러오지 못했습니다. ${error instanceof Error ? error.message : String(error)}`
            );
            return [];
        }
    }

    /** 뷰를 연결한다. 이 시점부터 description(현재 브랜치)과 안내 문구를 provider 가 관리한다. */
    public attachView(view: vscode.TreeView<RepoTreeEntry>): void {
        this.view = view;
        this.updateViewChrome();
    }

    /** 세션·브랜치가 바뀌었을 때: 캐시를 버리고 트리와 뷰 문구를 다시 그린다. */
    public onSessionChanged(): void {
        this.cache.clear();
        this.message = getCurrentBranch() ? undefined : NO_SESSION_MESSAGE;
        this.updateViewChrome();
        this.changeEmitter.fire();
    }

    /** 뷰 타이틀의 새로 고침(§15.3 `$(refresh)`). 캐시를 버리면 펼친 디렉터리부터 다시 조회한다. */
    public refresh(): void {
        this.cache.clear();
        this.changeEmitter.fire();
    }

    /**
     * 경로가 바뀐 디렉터리만 캐시에서 지우고 트리를 다시 그린다(§12.5 트리 변경).
     * 전체 캐시를 비우지 않는 이유: 파일 하나가 바뀌어도 펼쳐 둔 모든 디렉터리를 다시 받게 된다.
     */
    public invalidatePaths(paths: readonly string[]): void {
        const branch = getCurrentBranch();
        if (!branch) {
            this.refresh();
            return;
        }

        const keys = new Set<string>();
        for (const path of paths) {
            const slash = path.lastIndexOf('/');
            const parent = slash === -1 ? '' : path.slice(0, slash);
            keys.add(`${branch}|${parent}`);
            keys.add(`${branch}|${path}`);
        }

        let changed = false;
        for (const key of keys) {
            if (this.cache.delete(key)) {
                changed = true;
            }
        }

        if (changed) {
            this.changeEmitter.fire();
        }
    }

    public dispose(): void {
        this.changeEmitter.dispose();
    }

    private setMessage(message: string | undefined): void {
        this.message = message;
        this.updateViewChrome();
    }

    private updateViewChrome(): void {
        if (!this.view) {
            return;
        }

        this.view.description = getCurrentBranch(); // 현재 브랜치를 항상 보이게(§15.3)
        this.view.message = this.message;
    }
}

/** 트리 아이템의 가상 URI. 경로 조각마다 인코딩해 공백·한글이 섞여도 깨지지 않게 한다. */
export function repoResourceUri(repoId: number, branch: string, path: string): vscode.Uri {
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    return vscode.Uri.parse(`${REPO_TREE_SCHEME}://${repoId}/${branchSlug(branch)}/${encodedPath}`);
}

/**
 * Repository 뷰를 만들고 등록한다(§15.2, §15.3).
 * 세션·브랜치 변경은 repoSession 이벤트로 받아 provider 가 스스로 다시 그린다.
 */
export function createRepoTreeView(context: vscode.ExtensionContext): {
    view: vscode.TreeView<RepoTreeEntry>;
    provider: RepoTreeProvider;
} {
    const provider = new RepoTreeProvider();
    const view = vscode.window.createTreeView(VIEW_FILES, {
        treeDataProvider: provider,
        showCollapseAll: true
    });

    provider.attachView(view);
    context.subscriptions.push(view, provider, onDidChangeSession(() => provider.onSessionChanged()));

    return { view, provider };
}