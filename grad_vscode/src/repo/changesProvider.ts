import * as vscode from 'vscode';

import { getCurrentBranch, getSession, onDidChangeSession } from './repoSession';
import { NO_SESSION_MESSAGE, repoResourceUri } from './repoTreeProvider';
import {
    commitBlockedReason,
    getStatusEntries,
    getSyncInfo,
    labelForState,
    onDidChangeCommitState,
    onDidChangeStatus,
    refreshStatus
} from './repoStatus';

/**
 * [TASK_11 §15.3] Changes 뷰 — 현재 브랜치의 작업 트리 상태 + 커밋.
 *
 * Repository 트리는 파일이 있는 자리에 배지만 붙인다. 이 뷰는 반대로 "무엇이 바뀌었는가" 만 모아
 * 보여 준다 — `Staged Changes`(커밋 대상)와 `Changes`(아직 아님) 두 그룹이다(§3.2 `GET /api/github/repos/status`).
 * 그래서 지금 브랜치에서 무엇이 스테이징됐고 무엇이 수정됐는지 한 화면에서 보고, 그 자리에서
 * 스테이징/해제와 커밋을 할 수 있다(§1.3-8).
 *
 * 데이터 출처는 상태 모듈(`repoStatus`) 하나다 — 상태를 두 번 조회하지 않는다. 스테이징·해제·커밋은
 * 전부 그 모듈의 커맨드(`axis-share.stage` / `unstage` / `commit`)로 넘긴다(§15.7).
 * 커밋 입력창만은 뷰 타이틀의 `$(check)` 가 띄우는 입력 상자로 받는다 — TreeView 에는 입력창이 없다.
 */

const VIEW_CHANGES = 'axis-share-changes';

/** 그룹 1개. `staged` 가 true 면 커밋 대상이다. */
export type ChangesGroupItem = { kind: 'group'; staged: boolean; count: number };

/**
 * 파일 1개. 경로를 **최상위**에 두는 이유: 인라인 버튼이 넘기는 `{ path }` 와 모양을 맞추면
 * `stage`/`unstage` 커맨드가 트리 항목을 그대로 경로로 읽을 수 있다(`repoStatus.collectPaths`).
 */
export type ChangesFileItem = {
    kind: 'file';
    staged: boolean;
    path: string;
    state: string;
    from?: string;
};

export type ChangesItem = ChangesGroupItem | ChangesFileItem;

export class ChangesTreeProvider implements vscode.TreeDataProvider<ChangesItem>, vscode.Disposable {
    private readonly changeEmitter = new vscode.EventEmitter<ChangesItem | undefined>();

    public readonly onDidChangeTreeData = this.changeEmitter.event;

    private view: vscode.TreeView<ChangesItem> | undefined;

    public attachView(view: vscode.TreeView<ChangesItem>): void {
        this.view = view;
        this.updateChrome();
    }

    /** 상태·세션이 바뀌었을 때: 트리와 뷰 문구를 다시 그린다. */
    public refresh(): void {
        this.updateChrome();
        this.changeEmitter.fire(undefined);
    }

    public dispose(): void {
        this.changeEmitter.dispose();
    }

    public getTreeItem(item: ChangesItem): vscode.TreeItem {
        return item.kind === 'group' ? groupTreeItem(item) : fileTreeItem(item);
    }

    public getChildren(element?: ChangesItem): ChangesItem[] {
        const entries = getStatusEntries();
        if (entries.length === 0) {
            return []; // 빈 상태는 뷰 문구가 알린다(§15.12).
        }

        if (!element) {
            const staged = entries.filter((entry) => entry.staged).length;
            return [
                { kind: 'group', staged: true, count: staged },
                { kind: 'group', staged: false, count: entries.length - staged }
            ];
        }

        if (element.kind === 'group') {
            return entries
                .filter((entry) => entry.staged === element.staged)
                .slice()
                .sort((a, b) => a.path.localeCompare(b.path))
                .map((entry) => ({
                    kind: 'file' as const,
                    staged: element.staged,
                    path: entry.path,
                    state: entry.state,
                    from: entry.from
                }));
        }

        return []; // 파일 항목에는 자식이 없다.
    }

    /** 뷰 타이틀의 현재 브랜치와 빈 상태 문구를 맞춘다(§15.3, §15.12). */
    private updateChrome(): void {
        const view = this.view;
        if (!view) {
            return;
        }

        const session = getSession();
        const branch = getCurrentBranch();
        view.description = branch;

        if (!session || !branch) {
            view.badge = undefined;
            view.message = NO_SESSION_MESSAGE;
            return;
        }

        // push 대기 커밋 수는 뷰 뱃지로 알린다(커밋과 push 를 분리했으므로 남은 양을 눈에 띄게 둔다).
        const ahead = getSyncInfo().ahead;
        view.badge =
            ahead > 0
                ? { value: ahead, tooltip: `원격에 올리지 않은 커밋 ${ahead}개` }
                : undefined;

        // 우선순위: 변경 없음 → 커밋할 수 없는 이유. 둘 다 아니면 문구를 지운다(§15.12).
        const entries = getStatusEntries();
        if (entries.length > 0) {
            view.message = commitBlockedReason();
        } else if (ahead > 0) {
            view.message = `커밋되지 않은 변경은 없습니다. 원격에 올리지 않은 커밋이 ${ahead}개 있습니다.`;
        } else {
            view.message = '현재 브랜치에 커밋되지 않은 변경이 없습니다.';
        }
    }
}

/** 그룹 항목 — 항상 펼쳐 두어 탭을 열면 바로 파일이 보이게 한다. */
function groupTreeItem(item: ChangesGroupItem): vscode.TreeItem {
    const node = new vscode.TreeItem(
        item.staged ? 'Staged Changes' : 'Changes',
        vscode.TreeItemCollapsibleState.Expanded
    );

    node.id = item.staged ? 'staged' : 'changes';
    node.description = String(item.count);
    node.contextValue = item.staged ? 'axisStagedGroup' : 'axisUnstagedGroup';
    node.iconPath = new vscode.ThemeIcon(item.staged ? 'check' : 'edit');
    node.tooltip = item.staged ? '커밋에 포함될 파일입니다.' : '아직 스테이징되지 않은 변경입니다.';
    return node;
}

/**
 * 파일 항목. `resourceUri` 를 Repository 트리와 같은 가상 URI 로 주면 파일 배지(§15.3)가 그대로 붙는다.
 * 클릭하면 **변경 내용(diff)** 이 열리고(§15.15), 인라인 `$(add)`/`$(remove)` 가 스테이징을 부른다.
 * 파일 자체를 편집하려면 컨텍스트 메뉴의 "파일 열기"(`axis-share.openFile`)를 쓴다 — 탐색기와 달리
 * 이 뷰의 주 목적은 "무엇이 바뀌었나" 이기 때문이다.
 */
function fileTreeItem(item: ChangesFileItem): vscode.TreeItem {
    const node = new vscode.TreeItem(baseName(item.path), vscode.TreeItemCollapsibleState.None);
    const dir = dirName(item.path);
    const stateLabel = labelForState(item.state);

    node.id = `${item.staged ? 'staged' : 'unstaged'}|${item.path}`;
    node.contextValue = item.staged ? 'axisStagedFile' : 'axisUnstagedFile';
    node.description = dir;
    node.tooltip = item.from ? `${item.path}\n${stateLabel} ← ${item.from}` : `${item.path}\n${stateLabel}`;

    const session = getSession();
    const branch = getCurrentBranch();
    if (session && branch) {
        node.resourceUri = repoResourceUri(session.repoId, branch, item.path);
    }

    // 한 번 클릭 = 변경 내용 보기(§15.15). 그룹이 곧 비교 기준이다 — 스테이징됨은 HEAD↔인덱스,
    // 나머지는 HEAD↔트리 작업. 항목을 그대로 넘겨 커맨드가 staged/state 를 함께 본다(§15.7).
    node.command = { command: 'axis-share.openDiff', title: '변경 내용 보기', arguments: [item] };

    return node;
}

function baseName(path: string): string {
    const index = path.lastIndexOf('/');
    return index < 0 ? path : path.slice(index + 1);
}

function dirName(path: string): string | undefined {
    const index = path.lastIndexOf('/');
    return index <= 0 ? undefined : path.slice(0, index);
}

/**
 * Changes 뷰를 만들고 등록한다(§15.2).
 * 세션·상태·커밋 상태 변화는 `repoSession` 과 `repoStatus` 이벤트로 받아 스스로 다시 그린다.
 * 탭이 보일 때 한 번 더 조회한다 — 다른 사람이 방금 바꾼 내용을 열자마자 보게 하려는 것이다.
 */
export function createChangesView(context: vscode.ExtensionContext): vscode.TreeView<ChangesItem> {
    const provider = new ChangesTreeProvider();
    const view = vscode.window.createTreeView(VIEW_CHANGES, {
        treeDataProvider: provider
    });

    provider.attachView(view);

    context.subscriptions.push(
        view,
        provider,
        onDidChangeSession(() => provider.refresh()),
        onDidChangeStatus(() => provider.refresh()),
        onDidChangeCommitState(() => provider.refresh()),
        view.onDidChangeVisibility((event) => {
            if (event.visible) {
                void refreshStatus();
            }
        })
    );

    return view;
}