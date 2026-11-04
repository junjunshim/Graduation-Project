import * as vscode from 'vscode';

import {
    authorLabel,
    decorationCount,
    decorationFiles,
    decorationLine,
    decoIcon,
    decoLabel,
    formatTimestamp,
    memoLabel,
    onDidChangeDecorations,
    type Decoration
} from './decorations';
import { getCurrentBranch, getSession, onDidChangeSession } from './repoSession';
import { NO_SESSION_MESSAGE, repoResourceUri } from './repoTreeProvider';

/**
 * [TASK_11 §15.6] Reviews 뷰 — 브랜치에 달린 리뷰 데코레이션 목록.
 *
 * 레퍼런스에서 가져온 것은 **분류와 토글 개념**뿐이고, 구조는 파일별 그룹이다.
 *
 *   Reviews            [👁]              ← 표시 On/Off 토글(view/title)
 *   ▾ src/a.ts (3)
 *       ● 오타            L12 · 김철수
 *   ▸ docs/readme.md (1)
 *
 * 데이터 출처는 collab 이 보내는 **브랜치 리뷰 인덱스**다(§15.6) — 그래서 **파일을 열지 않아도**
 * 목록이 보인다. 줄 번호는 표시용 스냅샷이고, 실제 이동은 열린 doc 의 상대 좌표로 다시 계산한다(§8.10).
 *
 * 삭제는 누구나 할 수 있다 — 공개 범위는 전체 공개 고정이고 host 개념이 없다(§8.10 확정).
 */

const VIEW_REVIEWS = 'axis-share-reviews';

/** 방에 들어가기 전(또는 리뷰가 없을 때)의 안내(§15.6 빈 상태). */
const EMPTY_MESSAGE = '이 브랜치에 리뷰가 없습니다.';

/** 뷰가 그리는 항목. 파일 그룹과 데코레이션 1건, 두 종류다. */
export type ReviewsItem =
    | { kind: 'file'; path: string; decorations: readonly Decoration[] }
    | { kind: 'deco'; path: string; id: string; decoration: Decoration };

export class ReviewsTreeProvider implements vscode.TreeDataProvider<ReviewsItem>, vscode.Disposable {
    private readonly changeEmitter = new vscode.EventEmitter<void>();

    public readonly onDidChangeTreeData = this.changeEmitter.event;

    private view: vscode.TreeView<ReviewsItem> | undefined;

    public attachView(view: vscode.TreeView<ReviewsItem>): void {
        this.view = view;
        this.refresh();
    }

    public refresh(): void {
        this.changeEmitter.fire();
        this.updateViewChrome();
    }

    public dispose(): void {
        this.changeEmitter.dispose();
    }

    public getTreeItem(item: ReviewsItem): vscode.TreeItem {
        return item.kind === 'file' ? fileTreeItem(item) : decoTreeItem(item);
    }

    public getChildren(element?: ReviewsItem): ReviewsItem[] {
        if (!element) {
            return decorationFiles().map((file) => ({
                kind: 'file',
                path: file.path,
                decorations: file.decorations
            }));
        }

        if (element.kind === 'file') {
            return element.decorations.map((decoration) => ({
                kind: 'deco',
                path: decoration.path,
                id: decoration.id,
                decoration
            }));
        }

        return []; // 데코레이션 항목에는 자식이 없다.
    }

    /** 현재 브랜치·총 개수·빈 상태 문구를 맞춘다(§15.6). */
    private updateViewChrome(): void {
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

        // 배지는 뷰 타이틀의 숫자다 — 브랜치 전체 리뷰 수를 한눈에 보여 준다(§15.6).
        const count = decorationCount();
        view.badge = count > 0 ? { value: count, tooltip: `이 브랜치의 리뷰 ${count}개` } : undefined;
        view.message = count === 0 ? EMPTY_MESSAGE : undefined;
    }
}

/** 파일 그룹 한 줄. 라벨은 경로 전체다(§15.6) — 어느 디렉터리의 파일인지 접지 않고 알 수 있다. */
function fileTreeItem(item: Extract<ReviewsItem, { kind: 'file' }>): vscode.TreeItem {
    const node = new vscode.TreeItem(item.path, vscode.TreeItemCollapsibleState.Collapsed);

    // 항목 id 를 고정해야 다시 그려도 펼침 상태가 유지된다.
    node.id = `file:${item.path}`;
    node.description = `${item.decorations.length}개`;
    node.contextValue = 'axisDecoFile';
    node.tooltip = `${item.path} · 리뷰 ${item.decorations.length}개`;

    // 가상 URI 를 주면 Repository·Changes 와 같은 파일 아이콘·git 배지가 그대로 붙는다(§15.3).
    const session = getSession();
    const branch = getCurrentBranch();
    if (session && branch) {
        node.resourceUri = repoResourceUri(session.repoId, branch, item.path);
    }

    return node;
}

/** 데코레이션 한 줄. 클릭하면 그 파일을 열고 해당 줄로 이동한다(§15.6). */
function decoTreeItem(item: Extract<ReviewsItem, { kind: 'deco' }>): vscode.TreeItem {
    const decoration = item.decoration;
    const node = new vscode.TreeItem(memoLabel(decoration), vscode.TreeItemCollapsibleState.None);

    node.id = `deco:${decoration.path}:${decoration.id}`;
    node.description = describeLocation(decoration);
    // 색은 원격 커서·사용자 점과 같은 방식으로 등록 색을 참조한다(§15.8).
    node.iconPath = decoIcon(decoration.decoType);
    node.contextValue = 'axisDeco';
    node.tooltip = buildTooltip(decoration);

    // 클릭 = 이동. 항목을 그대로 넘겨 커맨드가 path/id 를 함께 본다.
    node.command = { command: 'axis-share.jumpToDecoration', title: '리뷰 위치로 이동', arguments: [item] };

    return node;
}

/** `L<줄> · <작성자>`. 줄을 아직 모르면 작성자만 적는다. */
function describeLocation(decoration: Decoration): string {
    const line = decorationLine(decoration);
    const author = authorLabel(decoration);
    return typeof line === 'number' ? `L${line + 1} · ${author}` : author;
}

/** 툴팁 = 종류 + 메모 전문 + 작성자 + 시각(§15.6). */
function buildTooltip(decoration: Decoration): vscode.MarkdownString {
    const markdown = new vscode.MarkdownString();
    markdown.appendMarkdown(`**${decoLabel(decoration.decoType)}**\n\n`);

    const memo = decoration.memo.trim();
    if (memo !== '') {
        markdown.appendMarkdown(`${memo}\n\n`);
    }

    const lines = [decoration.path, authorLabel(decoration)];
    const when = formatTimestamp(decoration.createdAt);
    if (when) {
        lines.push(when);
    }

    // 마크다운에서 줄바꿈은 뒤에 공백 두 칸이 필요하다.
    markdown.appendMarkdown(lines.join('  \n'));
    return markdown;
}

/**
 * Reviews 뷰를 만들고 등록한다(§15.2, §15.6).
 * 목록은 collab 이 밀어 주고(§15.6), 브랜치·세션 변화는 세션 이벤트로 다시 그린다.
 */
export function createReviewsView(context: vscode.ExtensionContext): vscode.TreeView<ReviewsItem> {
    const provider = new ReviewsTreeProvider();
    const view = vscode.window.createTreeView(VIEW_REVIEWS, {
        treeDataProvider: provider
    });

    provider.attachView(view);

    context.subscriptions.push(
        view,
        provider,
        onDidChangeSession(() => provider.refresh()),
        onDidChangeDecorations(() => provider.refresh())
    );

    return view;
}