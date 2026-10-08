import * as vscode from 'vscode';

import { ApiError, apiRequest } from '../api';
import { getCurrentBranch, getSession, setCurrentBranch, type RepoSession } from './repoSession';

/**
 * [TASK_11 §15.4] 브랜치 UI — 표시·전환·생성·삭제.
 *
 * 아이콘 하나(`$(git-branch)`)로 전환·생성·삭제를 모두 처리한다(VS Code 의 브랜치 피커와 같은 방식, §15.3).
 *
 * 전환의 정식 순서는 §10.3 이다 — 열린 파일 close → 제어 소켓 `switch_branch` 승인(C++ 권한 확인)
 * → 문서 소켓 전환 → 새 브랜치 트리 조회. 지금은 소켓과 열린 파일이 없으므로 "로컬 브랜치 변경 +
 * 트리 재조회"까지만 한다. 승인·문서 전환은 소켓(§15.10)·파일 열기(§12.4)가 붙을 때 이 파일에 이어 붙인다.
 */

/** GET /api/github/repos/branches 응답 행(§3.2). */
export type RepoBranch = {
    name: string;
    is_default: boolean;
    /**
     * 서버 `github_branches` 에 행이 있는가(§3.2). `false` 는 원격에만 있는 브랜치로,
     * 트리 조회는 되지만 접속자·편집 방을 열려면 먼저 등록해야 한다(§2.3).
     */
    is_registered?: boolean;
    base_branch?: string | null;
    worktree_path?: string;
    work_item_display_id?: string | null;
    presence?: { email: string; name?: string }[];
};

/** DELETE /api/github/repos/branches 가 P0810 으로 함께 돌려주는 작업 트리 항목(§3.2). */
export type WorktreeStatusEntry = {
    path: string;
    state: string;
    staged?: boolean;
};

/** 서버 상태 문자열 → 화면 문구(`porcelainState`, §3.2). */
const STATE_LABELS: Record<string, string> = {
    added: '추가',
    modified: '수정',
    deleted: '삭제',
    renamed: '이름변경',
    copied: '복사',
    typechange: '형식변경',
    conflicted: '충돌',
    untracked: '추적 안 됨'
};

type PickAction =
    | { kind: 'switch'; branch: string; registered: boolean }
    | { kind: 'create' }
    | { kind: 'delete'; branch: string };
type BranchPickItem = vscode.QuickPickItem & { action?: PickAction };

/** §15.4 이름 규칙: 앞뒤 공백을 없애고, 남은 공백은 '-' 로 바꾼다. */
export function normalizeBranchName(raw: string): string {
    return raw.trim().replace(/\s+/g, '-');
}

/** §15.4 금지 규칙. 통과하면 undefined, 실패하면 사유 문구를 돌려준다(git 이 거부할 이름을 미리 막는다). */
export function validateBranchName(name: string): string | undefined {
    if (name.length === 0) {
        return '브랜치 이름을 입력해 주세요.';
    }

    if (name.includes('..')) {
        return "'..' 는 쓸 수 없습니다.";
    }

    if (/[~^:?*\[\\]/.test(name)) {
        return "'~ ^ : ? * [ \\' 는 쓸 수 없습니다.";
    }

    if (name.includes('@{')) {
        return "'@{' 는 쓸 수 없습니다.";
    }

    if (name.endsWith('.lock')) {
        return "'.lock' 으로 끝날 수 없습니다.";
    }

    if (name.startsWith('/') || name.endsWith('/') || name.includes('//')) {
        return "'/' 를 연달아 쓰거나 처음·끝에 쓸 수 없습니다.";
    }

    return undefined;
}

/** 서버에서 브랜치 목록을 받는다. `is_default` 가 먼저 오도록 서버가 정렬한다(§3.2). */
export async function fetchBranches(repoId: number): Promise<RepoBranch[]> {
    const rows = await apiRequest<RepoBranch[]>(`/github/repos/branches?repo_id=${repoId}`);
    return Array.isArray(rows) ? rows : [];
}

/**
 * 브랜치 피커(§15.3). 선택 하나로 전환·생성·삭제를 모두 처리한다.
 */
export async function showBranchPicker(): Promise<void> {
    const session = getSession();
    if (!session) {
        void vscode.window.showWarningMessage(
            '저장소에 연결되어 있지 않습니다. 앱에서 저장소를 연결하고 "VSCode 로 실시간 편집" 을 눌러 주세요.'
        );
        return;
    }

    let branches: RepoBranch[];
    try {
        branches = await fetchBranches(session.repoId);
    } catch (error) {
        showFailureMessage('브랜치 목록을 불러오지 못했습니다.', error);
        return;
    }

    const current = getCurrentBranch();
    const items: BranchPickItem[] = branches.map((branch) => {
        const unregistered = branch.is_registered === false;
        return {
            label: `${branch.name === current ? '$(check) ' : ''}${branch.name}`,
            description: describeBranch(branch, current),
            detail: describeBranchDetail(branch, unregistered),
            action: { kind: 'switch', branch: branch.name, registered: !unregistered }
        };
    });

    if (items.length === 0) {
        void vscode.window.showWarningMessage('사용할 수 있는 브랜치가 없습니다.');
        return;
    }

    items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });

    items.push({ label: '$(add) 새 브랜치 만들기…', action: { kind: 'create' } });
    if (current) {
        items.push({
            label: '$(trash) 현재 브랜치 삭제',
            description: current === session.defaultBranch ? '기본 브랜치는 삭제할 수 없습니다' : current,
            action: { kind: 'delete', branch: current }
        });
    }

    const picked = await vscode.window.showQuickPick(items, {
        title: '브랜치',
        placeHolder: current ? `현재 브랜치: ${current}` : '브랜치를 선택하세요'
    });
    const action = picked?.action;
    if (!action) {
        return;
    }

    if (action.kind === 'switch') {
        await switchBranch(session, action.branch, action.registered);
        return;
    }

    if (action.kind === 'create') {
        await createBranchFlow(session);
        return;
    }

    await deleteBranchFlow(session, action.branch);
}

/**
 * 브랜치를 전환한다. 로컬 상태를 바꾸면 repoSession 이벤트로 트리가 다시 그려진다(§15.10).
 * 같은 브랜치를 다시 고른 경우에는 아무 일도 일어나지 않는다.
 *
 * 원격에만 있는 브랜치(`is_registered === false`)는 **먼저 서버에 등록한다.**
 * 브랜치 목록은 원격 ref 를 합쳐 보여 주지만, 접속자(presence)·편집 방은 `github_branches` 행이
 * 있어야 열린다(§2.3, §3.2). 등록은 그 원격 브랜치를 그대로 받아오므로 새로 만들어지지 않는다.
 * 이 등록을 건너뛰면 제어 소켓 `join` 이 P0801 로 거부되어 Editing 뷰가 비어 버린다(2026-10-08).
 */
async function switchBranch(session: RepoSession, branch: string, registered: boolean): Promise<void> {
    if (getCurrentBranch() === branch) {
        return;
    }

    if (!registered) {
        try {
            // 멱등하다 — 이미 등록돼 있으면 작업 디렉터리만 확인하고 그대로 돌아온다.
            await apiRequest('/github/repos/branches', {
                method: 'POST',
                body: { repo_id: session.repoId, name: branch }
            });
        } catch (error) {
            showFailureMessage(`'${branch}' 브랜치를 열지 못했습니다.`, error);
            return;
        }
    }

    setCurrentBranch(branch);
    void vscode.window.setStatusBarMessage(`Axis Share: 브랜치 ${branch} 로 전환했습니다.`, 4000);
}

/** 브랜치 생성: 이름 입력 → 시작 브랜치 선택 → POST. 성공하면 그 브랜치로 전환한다(§15.4). */
async function createBranchFlow(session: RepoSession): Promise<void> {
    const input = await vscode.window.showInputBox({
        title: '새 브랜치 만들기',
        prompt: '업무 코드를 앞에 붙이면 그 업무에 연결됩니다 (예: WI-101-login)',
        placeHolder: 'WI-101-login',
        validateInput: (value) => validateBranchName(normalizeBranchName(value))
    });
    if (input === undefined) {
        return;
    }

    const name = normalizeBranchName(input);

    // 시작 브랜치 선택. 목록을 못 받아도 기본 브랜치로는 만들 수 있으므로 실패를 치명적으로 다루지 않는다.
    let branches: RepoBranch[] = [];
    try {
        branches = await fetchBranches(session.repoId);
    } catch {
        branches = [];
    }

    const baseCandidates: BranchPickItem[] =
        branches.length > 0
            ? branches.map((branch) => ({
                  label: branch.name,
                  description: branch.is_default ? '기본 브랜치' : branch.name === getCurrentBranch() ? '현재' : ''
              }))
            : session.defaultBranch
              ? [{ label: session.defaultBranch, description: '기본 브랜치' }]
              : [];
    if (baseCandidates.length === 0) {
        void vscode.window.showWarningMessage('시작 브랜치를 고를 수 없습니다. 브랜치 목록 조회에 실패했습니다.');
        return;
    }

    const base = await vscode.window.showQuickPick(baseCandidates, {
        title: `'${name}' 의 시작 브랜치`,
        placeHolder: session.defaultBranch ?? baseCandidates[0].label
    });
    if (!base) {
        return;
    }

    try {
        // 서버는 생성 결과를 단일 객체로 돌려준다(§3.2).
        const created = await apiRequest<RepoBranch | RepoBranch[]>('/github/repos/branches', {
            method: 'POST',
            body: { repo_id: session.repoId, name, base_branch: base.label }
        });
        const row = firstBranch(created);

        setCurrentBranch(name); // 만든 브랜치로 바로 전환한다(§15.4)
        const linked = row?.work_item_display_id ? ` 업무 WI-${row.work_item_display_id} 에 연결되었습니다.` : '';
        void vscode.window.showInformationMessage(`'${name}' 브랜치를 만들었습니다.${linked}`);
    } catch (error) {
        showFailureMessage(`'${name}' 브랜치를 만들지 못했습니다.`, error);
    }
}

/** 브랜치 삭제: 확인 → DELETE. 서버가 거부하면 사유와 상세 목록을 보여 준다(§15.4). */
async function deleteBranchFlow(session: RepoSession, branch: string): Promise<void> {
    if (branch === session.defaultBranch) {
        void vscode.window.showWarningMessage('기본 브랜치는 삭제할 수 없습니다.');
        return;
    }

    const confirmed = await vscode.window.showWarningMessage(
        `'${branch}' 브랜치를 삭제할까요?`,
        { modal: true, detail: '서버의 브랜치 작업 디렉터리와 로컬 브랜치도 함께 정리됩니다.' },
        '삭제'
    );
    if (confirmed !== '삭제') {
        return;
    }

    await requestDeleteBranch(session, branch, false);
}

/**
 * 삭제 요청. `force` 는 "커밋되지 않은 변경" 확인만 건너뛴다 —
 * 접속자가 있으면(P0809) force 로도 지우지 않는다(서버 규칙).
 */
async function requestDeleteBranch(session: RepoSession, branch: string, force: boolean): Promise<void> {
    try {
        await apiRequest('/github/repos/branches', {
            method: 'DELETE',
            body: { repo_id: session.repoId, name: branch, force }
        });
    } catch (error) {
        if (error instanceof ApiError && error.code === 'P0810' && !force) {
            const choice = await vscode.window.showWarningMessage(
                `'${branch}' 브랜치에 커밋되지 않은 변경이 있습니다.`,
                { modal: true, detail: describeStatusEntries(error.data) },
                '강제 삭제'
            );
            if (choice === '강제 삭제') {
                await requestDeleteBranch(session, branch, true);
            }
            return;
        }

        if (error instanceof ApiError && error.code === 'P0809') {
            void vscode.window.showWarningMessage(`'${branch}' 브랜치에서 작업 중인 사용자가 있습니다.`, {
                modal: true,
                detail: describePresence(error.data)
            });
            return;
        }

        showFailureMessage(`'${branch}' 브랜치를 삭제하지 못했습니다.`, error);
        return;
    }

    // 삭제한 브랜치에 머물러 있으면 기본 브랜치로 옮긴다(§1.3-10 — 남이 지운 경우와 같은 결과).
    if (getCurrentBranch() === branch) {
        setCurrentBranch(session.defaultBranch);
    }

    void vscode.window.showInformationMessage(`'${branch}' 브랜치를 삭제했습니다.`);
}

/** 브랜치 한 줄 설명: 기본 브랜치 · 현재 · 원격에만 있음 · 접속자(§15.3 피커 표기). */
function describeBranch(branch: RepoBranch, current: string | undefined): string {
    const parts: string[] = [];
    if (branch.is_default) {
        parts.push('기본 브랜치');
    }
    if (branch.name === current) {
        parts.push('현재');
    }
    if (branch.is_registered === false) {
        parts.push('원격에만 있음');
    }

    const presence = Array.isArray(branch.presence) ? branch.presence : [];
    if (presence.length > 0) {
        const names = presence
            .slice(0, 2)
            .map((person) => person.name ?? person.email)
            .filter((name) => name.length > 0)
            .join(', ');
        const more = presence.length > 2 ? ` 외 ${presence.length - 2}명` : '';
        parts.push(`접속 ${presence.length}명${names ? `: ${names}${more}` : ''}`);
    }

    return parts.join(' · ');
}

/** 피커 상세줄: 업무 연결과 "아직 등록하지 않은 브랜치" 안내를 함께 보여 준다. */
function describeBranchDetail(branch: RepoBranch, unregistered: boolean): string | undefined {
    const parts: string[] = [];
    if (branch.work_item_display_id) {
        parts.push(`업무 WI-${branch.work_item_display_id}`);
    }
    if (unregistered) {
        parts.push('선택하면 서버에 등록하고 작업 디렉터리를 만듭니다');
    }

    return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** 생성 응답은 단일 객체다. 배열로 와도 받아 주도록 방어한다. */
function firstBranch(created: RepoBranch | RepoBranch[] | undefined): RepoBranch | undefined {
    if (Array.isArray(created)) {
        return created[0];
    }

    return created;
}

/** P0810 의 상세 목록(커밋되지 않은 변경)을 여러 줄 문구로 만든다. */
function describeStatusEntries(data: unknown): string {
    if (!Array.isArray(data) || data.length === 0) {
        return '변경 내용을 확인해 주세요.';
    }

    const shown = data.slice(0, 10).map((raw) => {
        const entry = raw as WorktreeStatusEntry;
        const state = STATE_LABELS[entry.state] ?? entry.state;
        return `${entry.path} (${state}${entry.staged ? ', staged' : ''})`;
    });
    if (data.length > shown.length) {
        shown.push(`외 ${data.length - shown.length}건`);
    }

    return shown.join('\n');
}

/** P0809 의 상세 목록(브랜치 접속자)을 여러 줄 문구로 만든다. */
function describePresence(data: unknown): string {
    if (!Array.isArray(data) || data.length === 0) {
        return '접속자 정보를 확인해 주세요.';
    }

    return data
        .slice(0, 10)
        .map((raw) => {
            const person = raw as { email?: string; name?: string };
            return person.name ? `${person.name} (${person.email ?? ''})` : (person.email ?? '알 수 없음');
        })
        .join('\n');
}

/** 서버가 준 사유 문구를 그대로 보여 준다(Pxxxx 는 사용자가 고칠 수 있는 원인을 담고 있다). */
function showFailureMessage(prefix: string, error: unknown): void {
    if (error instanceof ApiError) {
        void vscode.window.showWarningMessage(`${prefix} ${error.message}`);
        return;
    }

    void vscode.window.showErrorMessage(`${prefix} ${error instanceof Error ? error.message : String(error)}`);
}