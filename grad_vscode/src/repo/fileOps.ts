import * as vscode from 'vscode';

import { apiRequest, ApiError } from '../api';
import { onDidReceiveControlEvent } from './controlSocket';
import { getCurrentBranch, getSession } from './repoSession';
import { refreshStatus } from './repoStatus';
import type { RepoTreeEntry, RepoTreeProvider } from './repoTreeProvider';

/**
 * [TASK_11 §12.5] Repository 트리에서 파일·디렉터리를 만들고, 이름을 바꾸고, 지운다.
 *
 * 파일 시스템 변경은 **서버(C++)가 수행한다** — 클라이언트는 요청만 하고 직접 만들지 않는다(§12.5).
 * 그래야 다른 접속자에게 트리 변경이 같은 방식으로 전파되고, 추적/untracked 판정이 서버 한 곳에 모인다.
 * 서버는 브랜치의 작업 디렉터리(worktree)에서 일한다 — 같은 요청도 브랜치마다 다른 곳에 반영된다(§2.3).
 */

/** 뷰가 넘겨주는 트리 항목(RepoTreeEntry). 뷰 타이틀 아이콘으로 부르면 인자가 없다(루트 기준). */
function entryOf(argument: unknown): RepoTreeEntry | undefined {
    if (typeof argument !== 'object' || argument === null || Array.isArray(argument)) {
        return undefined;
    }

    const entry = argument as Partial<RepoTreeEntry>;
    if (typeof entry.path !== 'string' || typeof entry.name !== 'string') {
        return undefined;
    }

    return entry as RepoTreeEntry;
}

/**
 * 새 파일·디렉터리가 만들어질 디렉터리.
 * 파일 항목에서 부르면 그 파일이 있는 디렉터리를 쓴다(탐색기와 같은 동작).
 */
function targetDirectory(argument: unknown): string {
    const entry = entryOf(argument);
    if (!entry) {
        return '';
    }

    return entry.type === 'dir' ? entry.path : parentOf(entry.path);
}

function parentOf(path: string): string {
    const slash = path.lastIndexOf('/');
    return slash === -1 ? '' : path.slice(0, slash);
}

function joinPath(directory: string, name: string): string {
    return directory === '' ? name : `${directory}/${name}`;
}

/** 이름 한 조각만 받는다. 구분자·상대 경로 조각은 서버의 경로 검증에서 거부되므로 미리 막는다. */
function nameError(name: string): string | undefined {
    if (name.length === 0) {
        return '이름을 입력해 주세요.';
    }
    if (name.includes('/') || name.includes('\\')) {
        return '이름에는 / 나 \\ 를 쓸 수 없습니다.';
    }
    if (name === '.' || name === '..') {
        return '사용할 수 없는 이름입니다.';
    }

    return undefined;
}

/** 이름변경 입력 상자의 선택 범위 — 확장자는 남기고 앞부분만 고르게 한다(탐색기와 같다). */
function selectionFor(name: string): [number, number] {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? [0, dot] : [0, name.length];
}

function requireTarget(): { repoId: number; branch: string } | undefined {
    const session = getSession();
    const branch = getCurrentBranch();
    if (!session || !branch) {
        void vscode.window.showWarningMessage('Axis Share: 앱에서 저장소를 연결한 뒤 사용할 수 있습니다.');
        return undefined;
    }

    return { repoId: session.repoId, branch };
}

function showFailure(prefix: string, error: unknown): void {
    if (error instanceof ApiError) {
        void vscode.window.showWarningMessage(`Axis Share: ${prefix} ${error.message}`);
        return;
    }

    void vscode.window.showErrorMessage(
        `Axis Share: ${prefix} ${error instanceof Error ? error.message : String(error)}`
    );
}

/** P0810(커밋되지 않은 변경)의 상세 목록을 여러 줄 문구로 만든다. */
function describeEntries(data: unknown): string {
    if (!Array.isArray(data) || data.length === 0) {
        return '변경 내용을 확인해 주세요.';
    }

    return data
        .slice(0, 10)
        .map((raw) => {
            const entry = raw as { path?: string; state?: string; staged?: boolean };
            return `${entry.path ?? ''} (${entry.state ?? ''}${entry.staged ? ', staged' : ''})`;
        })
        .join('\n');
}

let treeProvider: RepoTreeProvider | undefined;

/** 트리와 변경 목록을 다시 그린다. 서버 이벤트를 기다리지 않고 누른 사람 화면을 먼저 맞춘다. */
function refreshViews(paths: readonly string[]): void {
    treeProvider?.invalidatePaths(paths);
    void refreshStatus();
}

// ---------------------------------------------------------------------------
// 커맨드 (§15.3 컨텍스트 메뉴)
// ---------------------------------------------------------------------------

/** `Axis Share: 새 파일` — 트리 타이틀 아이콘 또는 항목 컨텍스트 메뉴. */
export async function createFileCommand(argument?: unknown): Promise<void> {
    const target = requireTarget();
    if (!target) {
        return;
    }

    const directory = targetDirectory(argument);
    const name = await vscode.window.showInputBox({
        prompt: directory === '' ? '새 파일 이름' : `${directory} 에 만들 파일 이름`,
        placeHolder: 'example.ts',
        validateInput: (value) => nameError(value.trim())
    });
    if (name === undefined) {
        return;
    }

    const path = joinPath(directory, name.trim());
    try {
        await apiRequest('/github/repos/files', {
            method: 'POST',
            body: { repo_id: target.repoId, branch: target.branch, path }
        });
    } catch (error) {
        showFailure('파일을 만들지 못했습니다.', error);
        return;
    }

    refreshViews([path]);
}

/** `Axis Share: 새 폴더` — 빈 디렉터리는 git 이 추적하지 않으므로 그 안에 파일을 만들기 전에는 트리에 나오지 않는다. */
export async function createDirectoryCommand(argument?: unknown): Promise<void> {
    const target = requireTarget();
    if (!target) {
        return;
    }

    const directory = targetDirectory(argument);
    const name = await vscode.window.showInputBox({
        prompt: directory === '' ? '새 폴더 이름' : `${directory} 에 만들 폴더 이름`,
        placeHolder: 'src',
        validateInput: (value) => nameError(value.trim())
    });
    if (name === undefined) {
        return;
    }

    const path = joinPath(directory, name.trim());
    try {
        await apiRequest('/github/repos/dirs', {
            method: 'POST',
            body: { repo_id: target.repoId, branch: target.branch, path }
        });
    } catch (error) {
        showFailure('폴더를 만들지 못했습니다.', error);
        return;
    }

    refreshViews([path]);
}

/** `Axis Share: 이름 바꾸기` — 추적되는 파일은 git mv 로, untracked 는 파일 이동으로 처리한다(서버). */
export async function renameEntryCommand(argument?: unknown): Promise<void> {
    const target = requireTarget();
    if (!target) {
        return;
    }

    const entry = entryOf(argument);
    if (!entry) {
        void vscode.window.showWarningMessage('Axis Share: 이름을 바꿀 항목을 선택해 주세요.');
        return;
    }

    const name = await vscode.window.showInputBox({
        prompt: '새 이름',
        value: entry.name,
        valueSelection: selectionFor(entry.name),
        validateInput: (value) => nameError(value.trim())
    });
    if (name === undefined) {
        return;
    }

    const trimmed = name.trim();
    if (trimmed === entry.name) {
        return;
    }

    const to = joinPath(parentOf(entry.path), trimmed);
    try {
        await apiRequest('/github/repos/files', {
            method: 'PATCH',
            body: { repo_id: target.repoId, branch: target.branch, from: entry.path, to }
        });
    } catch (error) {
        showFailure('이름을 바꾸지 못했습니다.', error);
        return;
    }

    refreshViews([entry.path, to]);
}

/** `Axis Share: 삭제` — 확인을 받고 지운다. 커밋되지 않은 변경이 있으면 서버가 한 번 더 확인을 요구한다(P0810). */
export async function deleteEntryCommand(argument?: unknown): Promise<void> {
    const target = requireTarget();
    if (!target) {
        return;
    }

    const entry = entryOf(argument);
    if (!entry) {
        void vscode.window.showWarningMessage('Axis Share: 삭제할 항목을 선택해 주세요.');
        return;
    }

    const kind = entry.type === 'dir' ? '폴더' : '파일';
    const confirmed = await vscode.window.showWarningMessage(
        `${kind} '${entry.name}' 을(를) 삭제할까요?`,
        { modal: true, detail: '커밋하지 않은 변경이 있으면 저장 여부를 한 번 더 묻습니다.' },
        '삭제'
    );
    if (confirmed !== '삭제') {
        return;
    }

    await requestDelete(target.repoId, target.branch, entry.path, false);
}

async function requestDelete(repoId: number, branch: string, path: string, force: boolean): Promise<void> {
    try {
        await apiRequest('/github/repos/files', {
            method: 'DELETE',
            body: { repo_id: repoId, branch, path, force }
        });
    } catch (error) {
        // 서버는 force 로만 "커밋되지 않은 변경" 확인을 건너뛴다(브랜치 삭제와 같은 규칙, §12.5).
        if (error instanceof ApiError && error.code === 'P0810' && !force) {
            const choice = await vscode.window.showWarningMessage(
                `'${path}' 에 커밋되지 않은 변경이 있습니다.`,
                { modal: true, detail: describeEntries(error.data) },
                '강제 삭제'
            );
            if (choice === '강제 삭제') {
                await requestDelete(repoId, branch, path, true);
            }
            return;
        }

        showFailure('삭제하지 못했습니다.', error);
        return;
    }

    refreshViews([path]);
}

/** `Axis Share: 경로 복사` — 저장소 상대 경로를 클립보드에 넣는다(서버 호출 없음). */
export async function copyPathCommand(argument?: unknown): Promise<void> {
    const entry = entryOf(argument);
    if (!entry) {
        void vscode.window.showWarningMessage('Axis Share: 경로를 복사할 항목을 선택해 주세요.');
        return;
    }

    await vscode.env.clipboard.writeText(entry.path);
    void vscode.window.showInformationMessage(`Axis Share: 경로를 복사했습니다 — ${entry.path}`);
}

// ---------------------------------------------------------------------------
// 트리 변경 이벤트 (§12.5 브로드캐스트)
// ---------------------------------------------------------------------------

/**
 * 같은 브랜치의 다른 접속자가 파일을 만들거나 지우거나 옮기면 Repository 트리를 다시 그린다(§12.5).
 * 이벤트가 잠깐 사이에 여러 번 올 수 있어 모아서 한 번만 다시 그린다.
 */
export function startFileOps(context: vscode.ExtensionContext, provider: RepoTreeProvider): void {
    treeProvider = provider;

    const pending = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = (paths: readonly string[]): void => {
        for (const path of paths) {
            pending.add(path);
        }
        if (timer) {
            clearTimeout(timer);
        }
        timer = setTimeout(() => {
            timer = undefined;
            const paths = [...pending];
            pending.clear();
            provider.invalidatePaths(paths);
        }, 150);
    };

    const subscription = onDidReceiveControlEvent((event) => {
        const session = getSession();
        if (!session || event.repoId !== session.repoId || event.branch !== getCurrentBranch()) {
            return;
        }

        const path = typeof event.raw.path === 'string' ? event.raw.path : '';
        const from = typeof event.raw.from === 'string' ? event.raw.from : '';
        switch (event.type) {
            case 'file_created':
            case 'dir_created':
            case 'file_deleted':
                schedule(path === '' ? [] : [path]);
                return;
            case 'file_moved':
                schedule([from, path].filter((value) => value !== ''));
                return;
            default:
                return;
        }
    });

    context.subscriptions.push(subscription, {
        dispose: () => {
            if (timer) {
                clearTimeout(timer);
            }
        }
    });
}