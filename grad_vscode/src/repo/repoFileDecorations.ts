import * as vscode from 'vscode';

import { REPO_TREE_SCHEME } from './repoTreeProvider';
import { badgeForState, labelForState, lookupStatus, onDidChangeStatus } from './repoStatus';

/**
 * [TASK_11 §15.3] git 상태 파일 배지 — Repository 트리 · Changes 뷰 · 열린 문서.
 *
 * 작업 트리 상태(§3.2)를 파일 이름 옆 글자 배지로 보여 준다(`M` `A` `U` `D` `R` …).
 * 트리·Changes 아이템은 저장소 기준 가상 URI(`axis-share-repo://`)를, 에디터에 열린 로컬 사본
 * 문서는 `file://` 를 쓴다. 둘 다 같은 상태를 가리키므로 한 provider 가 두 스킴을 함께 처리한다
 * (§15.3 "탐색기와 자동으로 일치"). 사용자의 임시 사본(globalStorage) 경로는 화면 어디에도 드러나지 않는다.
 *
 * 색은 **내장 테마 색**(`gitDecoration.*`)을 쓴다. 내장 git 과 같은 색이라 테마가 바뀌어도 자연스럽게
 * 따라가고, 확장이 등록한 색 id 를 파일 데코레이션에서 해석하지 못하는 문제(§15.8 의 2026-10-09 기록)도
 * 피할 수 있다.
 */

/**
 * (상태, 스테이징 여부) → 배지 색(내장 git 데코레이션 색 id).
 *
 * 표는 내장 git 확장의 색 선택(`GitStatus.getStatusColor`, VS Code `extensions/git`)과 같게 맞춘다.
 * 여기서 중요한 건 **스테이징 여부가 글자가 아니라 색으로 갈린다**는 점이다 — 수정한 파일을 스테이징하면
 * 글자는 그대로 `M` 이고 색만 스테이징 색으로 바뀐다(삭제도 `D` 그대로, 색만 바뀐다). 그래서 색을 고를 때
 * `staged` 를 함께 본다.
 */
function colorForStatus(state: string, staged: boolean): string | undefined {
    switch (state) {
        case 'added': // INDEX_ADDED — 스테이징된 새 파일
            return 'gitDecoration.addedResourceForeground';
        case 'untracked':
            return 'gitDecoration.untrackedResourceForeground';
        case 'modified':
            return staged
                ? 'gitDecoration.stageModifiedResourceForeground'
                : 'gitDecoration.modifiedResourceForeground';
        case 'deleted':
            return staged
                ? 'gitDecoration.stageDeletedResourceForeground'
                : 'gitDecoration.deletedResourceForeground';
        case 'renamed':
        case 'copied':
            return 'gitDecoration.renamedResourceForeground';
        case 'typechange':
            return 'gitDecoration.modifiedResourceForeground';
        case 'conflicted':
            return 'gitDecoration.conflictingResourceForeground';
        default:
            return undefined;
    }
}

class RepoFileDecorationProvider implements vscode.FileDecorationProvider {
    private readonly changeEmitter = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();

    /** `undefined` 를 실어 보내면 "모든 배지를 다시 계산하라" 는 뜻이다. */
    public readonly onDidChangeFileDecorations = this.changeEmitter.event;

    public provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
        // 트리 가상 URI 와 로컬 사본 파일만 대상이다. 다른 파일은 즉시 넘긴다.
        if (uri.scheme !== REPO_TREE_SCHEME && uri.scheme !== 'file') {
            return undefined;
        }

        const entry = lookupStatus(uri);
        if (!entry) {
            return undefined;
        }

        const badge = badgeForState(entry.state);
        const label = labelForState(entry.state);
        // 글자가 스테이징 여부를 말해 주지 않으므로 툴팁에 상태를 함께 적는다.
        const stageNote = entry.staged ? ' · 스테이징됨' : '';
        const tooltip = `${entry.from ? `${label} ← ${entry.from}` : label}${stageNote}`;
        const colorId = colorForStatus(entry.state, entry.staged);

        return new vscode.FileDecoration(
            badge,
            tooltip,
            colorId ? new vscode.ThemeColor(colorId) : undefined
        );
    }

    /** 상태가 바뀌면 모든 배지를 다시 계산하게 한다. */
    public refreshAll(): void {
        this.changeEmitter.fire(undefined);
    }

    public dispose(): void {
        this.changeEmitter.dispose();
    }
}

/**
 * 파일 배지 provider 를 등록한다. `extension.ts` activate 에서 한 번 부른다.
 * 상태 변화는 상태 모듈(`repoStatus`)의 `onDidChangeStatus` 를 그대로 따라간다 — 출처가 하나다.
 */
export function createRepoFileDecorations(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new RepoFileDecorationProvider();

    context.subscriptions.push(
        provider,
        vscode.window.registerFileDecorationProvider(provider),
        onDidChangeStatus(() => provider.refreshAll())
    );

    return provider;
}