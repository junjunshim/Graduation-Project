import * as vscode from 'vscode';

import { apiRequest } from '../api';
import { onDidReceiveControlEvent, type ControlEvent } from './controlSocket';
import { localCopyUri } from './docSocket';
import { getCurrentBranch, getSession, onDidChangeSession } from './repoSession';
import { repoResourceUri } from './repoTreeProvider';

/**
 * [TASK_11 §15.7] 작업 트리 상태 + 커밋 — 서버 REST 제어.
 *
 * 데이터 출처는 서버다(§3.2 `GET /api/github/repos/status`). 여기서 받은 상태를 Changes 뷰(§15.3)와
 * 파일 배지(§15.3)가 함께 읽고, 스테이징·커밋을 서버 REST 로 넘긴다. 실제 파일 상태·커밋의 진실은
 * 서버 로컬 저장소에 있다.
 *
 * **네이티브 소스 제어(SCM)는 쓰지 않는다(2026-10-09 확정).** 처음에는 `vscode.scm.createSourceControl`
 * 로 커밋 입력창·그룹을 VS Code 에 그리게 했지만, 그러면 Source Control 에 우리 항목이 뜨고 그 경로가
 * 사용자 PC 의 임시 사본(globalStorage)을 가리키게 된다. 상태도 스테이징도 커밋도 Changes 뷰 한 곳에서 다룬다.
 *
 * 지키는 규칙 셋(§15.7, §12.11):
 *   1. 스테이징은 "커밋 대상 표시" 다. 진짜 `git add` 는 커밋 시점에 서버가 다시 한다.
 *   2. `user.name` / `user.email` 이 없으면 커밋을 시작하지 않는다 — 커밋 자격은 그 둘이 정한다(§1.3-9).
 *   3. 커밋 순서(제어 소켓 `commit_started` → collab flush → git add/commit)는 서버가 정한다.
 *      UI 는 그 순서에 끼어들지 않고, `commit_started` / `commit_finished` 로 잠금만 맞춘다.
 *   4. 커밋과 원격 전송(push)은 분리한다(2026-10-09). 커밋은 서버 로컬에만 남고 push 는 별도
 *      커맨드(`axis-share.push`)로 사용자가 원할 때만 한다 — 로컬에만 쌓아 두는 흐름을 허용한다.
 */

/** 커밋 메시지 입력창 안내(§15.7). 업무 코드를 넣으면 서버가 업무 상태를 전환한다(§2.6). */
const COMMIT_PLACEHOLDER = 'WI-101 커밋 메시지 — 업무 코드를 넣으면 상태가 자동 전환됩니다';

/** 파일 상태 1건(§3.2 `GET /api/github/repos/status`). `staged` 로 그룹이 갈린다. */
export type RepoStatusEntry = {
    path: string;
    /** `added|modified|deleted|renamed|copied|typechange|conflicted|untracked` (§3.2). */
    state: string;
    staged: boolean;
    /** `renamed` / `copied` 의 원본 경로. */
    from?: string;
};

/** 상태 문자열 → 파일 배지 글자. git(`porcelainState`)과 같은 규칙이라 눈에 익다. */
const STATE_BADGE: Record<string, string> = {
    added: 'A',
    modified: 'M',
    deleted: 'D',
    renamed: 'R',
    copied: 'C',
    typechange: 'T',
    conflicted: 'U',
    untracked: 'U'
};

/** 상태 문자열 → 한국어 라벨(툴팁·알림). 색만으로 의미를 전하지 않기 위해 쓴다(§15.12). */
const STATE_LABEL: Record<string, string> = {
    added: '추가',
    modified: '수정',
    deleted: '삭제',
    renamed: '이름변경',
    copied: '복사',
    typechange: '형식변경',
    conflicted: '충돌',
    untracked: '추적 안 됨'
};

/** push 실패 사유(§12.11 `classifyPushFailure`) → 사용자가 다음에 할 일. */
const PUSH_GUIDE: Record<string, string> = {
    credential_missing: '앱 상단의 사용자 아이콘에서 GitHub PAT 자격증명을 등록해 주세요.',
    credential_invalid: 'GitHub 자격증명이 유효하지 않습니다. 앱에서 PAT 를 다시 등록해 주세요.',
    denied: '이 GitHub 계정에 push 권한이 없습니다. 저장소 권한을 확인해 주세요.',
    non_fast_forward: '원격에 새 커밋이 있습니다. ⟳ 로 가져온 뒤 다시 push 해 주세요.',
    other: '원격 저장소 상태를 확인한 뒤 다시 시도해 주세요.'
};

/** 커밋·push 응답의 `data[0]` 중 확장이 쓰는 필드(§3.2, §12.11). */
type CommitResultRow = {
    sha?: string;
    message?: string;
    pushed?: boolean;
    reason?: string;
    reason_label?: string;
    code?: string;
    ahead?: number;
    behind?: number;
    has_upstream?: boolean;
    matched_work_item_id?: string | null;
    matched_display_id?: number | null;
    status_transition?: { applied?: boolean; from?: string; to?: string };
};

/** `GET /api/github/repos/sync` 응답의 `data[0]`(§3.2). 커밋·push 뱃지와 graph 뷰가 쓴다. */
export type SyncInfo = {
    has_upstream: boolean;
    head_sha?: string;
    origin_sha?: string;
    ahead: number;
    behind: number;
};

let started = false;

/** 마지막으로 받은 작업 트리 상태. Changes 뷰(§15.3)와 파일 배지가 이 값을 쓴다. */
let statusEntries: readonly RepoStatusEntry[] = [];

/** 상태를 URI 로 되짚는 색인. 키는 가상 URI 와 로컬 사본 URI 둘 다다(§15.3). */
let statusByUri = new Map<string, RepoStatusEntry>();

/**
 * 조회 응답의 세대 키(`repoId|branch`). 응답이 늦게 도착했을 때 낡은 값을 버리는 기준이다 —
 * 브랜치를 빠르게 바꾸면 이전 브랜치의 상태가 뒤늦게 덮어쓸 수 있다.
 */
let statusKey: string | undefined;

/** 내 커밋이 진행 중인가. 그동안 커밋 커맨드를 잠근다(§15.7). */
let committing = false;

/** 같은 브랜치의 다른 사람이 커밋 중인가(제어 소켓 `commit_started`, §15.7). */
let remoteCommitting = false;

/** 마지막으로 띄운 조회 오류 문구. 같은 오류로 알림이 반복되지 않게 한다. */
let lastStatusError: string | undefined;

/** 원격 대비 위치(§3.2 sync). `ahead` 가 push 대기 커밋 수다 — 커밋과 push 를 분리했기 때문에 필요하다. */
let syncInfo: SyncInfo = { has_upstream: false, ahead: 0, behind: 0 };

const statusEmitter = new vscode.EventEmitter<void>();

/** 작업 트리 상태가 바뀌었다. Changes 뷰와 파일 배지가 이 이벤트로 다시 그린다(§15.10). */
export const onDidChangeStatus = statusEmitter.event;

const commitStateEmitter = new vscode.EventEmitter<void>();

/** 커밋 진행 상태나 커밋 사용자 설정이 바뀌었다. Changes 뷰가 안내 문구를 다시 그린다(§15.12). */
export const onDidChangeCommitState = commitStateEmitter.event;

const commitListEmitter = new vscode.EventEmitter<void>();

/** 커밋 이력이 바뀌었다(내/다른 사용자의 커밋·push). Graph 뷰가 이 이벤트로 목록을 다시 받는다(§15.14). */
export const onDidChangeCommitList = commitListEmitter.event;

/**
 * 현재 작업 트리 상태(§3.2). Changes 뷰(§15.3)와 배지 provider 가 같은 값을 읽는다 — 출처는 하나다.
 */
export function getStatusEntries(): readonly RepoStatusEntry[] {
    return statusEntries;
}

/** 원격 대비 위치(§3.2 sync). Changes 뷰 뱃지와 push 안내가 쓴다. */
export function getSyncInfo(): SyncInfo {
    return syncInfo;
}

/** 상태 문자열 → 파일 배지 글자. 배지 provider(§15.3)가 같은 함수를 쓴다. */
export function badgeForState(state: string): string {
    return STATE_BADGE[state] ?? '?';
}

/** 상태 문자열 → 한국어 라벨. 배지 툴팁이 쓴다. */
export function labelForState(state: string): string {
    return STATE_LABEL[state] ?? state;
}

/**
 * 트리·Changes 아이템의 가상 URI, 그리고 에디터에 열린 로컬 사본 문서의 `file://` URI 로
 * 상태 1건을 찾는다(§15.3). 파일 배지 provider 가 URI 만 받아 이 함수로 되짚는다.
 */
export function lookupStatus(uri: vscode.Uri): RepoStatusEntry | undefined {
    return statusByUri.get(uri.toString());
}

/**
 * Changes 뷰 문구용 — 지금 커밋할 수 없는 이유(§15.12). 없으면 undefined.
 * 진행 중이면 그 사실을, 커밋 사용자가 비었으면 설정 안내를 돌려준다.
 */
export function commitBlockedReason(): string | undefined {
    if (committing) {
        return '커밋 중입니다…';
    }

    if (remoteCommitting) {
        return '같은 브랜치의 다른 사용자가 커밋 중입니다…';
    }

    const identity = readIdentity();
    if (identity.name.length === 0 || identity.email.length === 0) {
        return '커밋하려면 커밋 사용자(user.name / user.email)를 설정해 주세요.';
    }

    return undefined;
}

/**
 * Changes 뷰 문구용 — 지금 push 할 수 없는 이유(§15.12). 없으면 undefined.
 * 커밋·push 를 분리했으므로 "올릴 커밋이 없음" 도 여기서 알린다.
 */
export function pushBlockedReason(): string | undefined {
    if (committing) {
        return '커밋 중입니다…';
    }

    if (remoteCommitting) {
        return '같은 브랜치의 다른 사용자가 커밋 중입니다…';
    }

    if (syncInfo.ahead === 0) {
        return '원격에 올릴 커밋이 없습니다.';
    }

    return undefined;
}

// ---------------------------------------------------------------------------
// 수명주기
// ---------------------------------------------------------------------------

/** 작업 트리 상태 추적을 시작한다. `extension.ts` activate 에서 한 번 부른다. */
export function startRepoStatus(context: vscode.ExtensionContext): void {
    if (started) {
        return;
    }

    started = true;

    context.subscriptions.push(
        // 저장소·브랜치가 바뀌면 이전 상태를 버리고 새 브랜치 상태를 받는다.
        onDidChangeSession(() => onSessionChanged()),
        // 같은 브랜치의 커밋 시작·종료를 받아 잠금과 상태를 맞춘다(§15.10).
        onDidReceiveControlEvent((event) => onControlEvent(event)),
        // user.name / user.email 이 바뀌면 커밋 안내 문구를 다시 정한다(§1.3-9).
        vscode.workspace.onDidChangeConfiguration((event) => {
            if (event.affectsConfiguration('axis-share.user')) {
                commitStateEmitter.fire();
            }
        }),
        { dispose: () => stopRepoStatus() }
    );

    onSessionChanged();
}

/** 확장 종료. 상태를 비우고 안내 문구를 다시 그리게 한다. */
export function stopRepoStatus(): void {
    started = false;
    committing = false;
    remoteCommitting = false;
    clearStatus();
    commitStateEmitter.fire();
}

/** 세션·브랜치 변경: 이전 브랜치 상태를 먼저 비우고 새 브랜치 상태를 조회한다. */
function onSessionChanged(): void {
    clearStatus();
    commitStateEmitter.fire();
    void refreshStatus();
}

// ---------------------------------------------------------------------------
// 커맨드 (extension.ts 가 등록한다) — 아이덴티티 설정 / fetch / 스테이징 / 커밋
// ---------------------------------------------------------------------------

/**
 * 커밋 아이덴티티 설정(§1.3-9). Changes 뷰 타이틀의 ⚙ 가 부른다.
 * 이메일은 서버가 로그인 계정과 대조하므로(§2.4) 다르면 저장하지 않고 그 자리에서 막는다.
 */
export async function showIdentitySettings(): Promise<void> {
    const session = getSession();
    const current = readIdentity();

    const name = await vscode.window.showInputBox({
        title: '커밋 사용자 — 이름',
        prompt: '커밋에 기록할 이름(user.name).',
        value: current.name,
        ignoreFocusOut: true,
        validateInput: (value) => (value.trim().length === 0 ? '이름을 입력해 주세요.' : undefined)
    });
    if (name === undefined) {
        return; // 사용자가 취소했다.
    }

    const accountEmail = session?.userEmail;
    const email = await vscode.window.showInputBox({
        title: '커밋 사용자 — 이메일',
        prompt: accountEmail
            ? `로그인 계정과 같은 이메일이어야 합니다: ${accountEmail}`
            : '커밋에 기록할 이메일(user.email).',
        value: current.email || accountEmail || '',
        ignoreFocusOut: true,
        validateInput: (value) => {
            const trimmed = value.trim();
            if (trimmed.length === 0) {
                return '이메일을 입력해 주세요.';
            }

            if (accountEmail && trimmed.toLowerCase() !== accountEmail.toLowerCase()) {
                return `로그인 계정 이메일과 같아야 합니다: ${accountEmail}`;
            }

            return undefined;
        }
    });
    if (email === undefined) {
        return;
    }

    const config = vscode.workspace.getConfiguration('axis-share');
    await config.update('user.name', name.trim(), vscode.ConfigurationTarget.Global);
    await config.update('user.email', email.trim(), vscode.ConfigurationTarget.Global);

    commitStateEmitter.fire();
    void vscode.window.showInformationMessage('Axis Share: 커밋 사용자 정보를 저장했습니다.');
}

/** 수동 fetch(§1.4). push 가 non-fast-forward 로 막힐 때 먼저 쓴다. */
export async function fetchRemote(): Promise<void> {
    const session = getSession();
    if (!session) {
        void vscode.window.showWarningMessage('저장소에 연결되어 있지 않습니다. 앱에서 저장소를 연결해 주세요.');
        return;
    }

    try {
        await apiRequest('/github/repos/fetch', { method: 'POST', body: { repo_id: session.repoId } });
        void vscode.window.showInformationMessage('Axis Share: 원격 저장소를 최신으로 맞췄습니다.');
        await refreshStatus();
    } catch (error) {
        showError('원격 저장소를 가져오지 못했습니다.', error);
    }
}

/**
 * 커밋한 내용을 원격으로 올린다(§3.2 `POST /api/github/repos/push`, §12.11).
 *
 * 커밋과 분리된 별도 동작이다 — 커밋은 서버 로컬에만 남고, push 는 사용자가 원할 때만 한다.
 * 그래서 로컬에만 쌓아 두고 나중에 한 번에 올리는 흐름도 가능하다.
 */
export async function pushBranch(): Promise<void> {
    const session = getSession();
    const branch = getCurrentBranch();
    if (!session || !branch) {
        void vscode.window.showWarningMessage('저장소에 연결되어 있지 않습니다. 앱에서 저장소를 연결해 주세요.');
        return;
    }

    const blocked = pushBlockedReason();
    if (blocked) {
        void vscode.window.showWarningMessage(`Axis Share: ${blocked}`);
        return;
    }

    try {
        const rows = await apiRequest<CommitResultRow[]>('/github/repos/push', {
            method: 'POST',
            body: { repo_id: session.repoId, branch }
        });
        reportPushResult(Array.isArray(rows) ? rows[0] : undefined);
        await refreshStatus();
        commitListEmitter.fire(); // 원격 위치(origin/<branch>)가 바뀌었다 — Graph 뷰를 다시 받는다(§15.14).
    } catch (error) {
        showError('원격에 push 하지 못했습니다.', error);
    }
}

/** push 결과를 사용자에게 알린다(§12.11 — 실패 사유와 다음 행동을 함께 보여 준다). */
function reportPushResult(row: CommitResultRow | undefined): void {
    if (row?.pushed) {
        void vscode.window.showInformationMessage('Axis Share: 원격에 push 했습니다.');
        return;
    }

    const reason = typeof row?.reason === 'string' ? row.reason : 'other';
    if (reason === 'nothing_to_push') {
        void vscode.window.showInformationMessage('Axis Share: 원격에 올릴 커밋이 없습니다.');
        return;
    }

    const label = typeof row?.reason_label === 'string' ? row.reason_label : 'push 실패';
    const guide = PUSH_GUIDE[reason] ?? PUSH_GUIDE.other;
    void vscode.window.showWarningMessage(`Axis Share: 원격 push 를 하지 못했습니다 (${label}). ${guide}`);
}

/**
 * 스테이징 / 스테이징 해제(§15.7). Changes 뷰의 인라인 `$(add)` / `$(remove)` 버튼이 부른다.
 * 여러 개를 고르면 VS Code 가 인자를 여러 개로 넘기므로 평평하게 펴서 한 번에 보낸다.
 */
export async function applyStage(stage: boolean, args: unknown[]): Promise<void> {
    const paths = collectPaths(args);
    if (paths.length === 0) {
        return;
    }

    await stagePaths(stage, paths);
}

/** 모두 스테이징 / 모두 해제. Changes 뷰 타이틀 버튼이 부른다. */
export async function applyStageAll(stage: boolean): Promise<void> {
    const paths = unique(statusEntries.map((entry) => entry.path));
    if (paths.length === 0) {
        return;
    }

    await stagePaths(stage, paths);
}

/** 실제 스테이징 호출. 서버가 스테이징 뒤의 전체 상태를 돌려주므로 그대로 다시 그린다(§3.2). */
async function stagePaths(stage: boolean, paths: readonly string[]): Promise<void> {
    const session = getSession();
    const branch = getCurrentBranch();
    if (!session || !branch) {
        return;
    }

    const key = `${session.repoId}|${branch}`;
    try {
        const rows = await apiRequest<RepoStatusEntry[]>('/github/repos/stage', {
            method: stage ? 'POST' : 'DELETE',
            body: { repo_id: session.repoId, branch, paths }
        });
        if (statusKey !== key) {
            return; // 그 사이 저장소·브랜치가 바뀌었다 — 낡은 응답은 버린다.
        }

        setStatus(Array.isArray(rows) ? rows.filter(isStatusEntry) : []);
    } catch (error) {
        showError(stage ? '스테이징하지 못했습니다.' : '스테이징을 해제하지 못했습니다.', error);
    }
}

/**
 * 커밋한다(§15.7 → §12.11). Changes 뷰 타이틀의 `$(check)` 가 부른다. 커밋 메시지는 여기서 입력받는다.
 *
 * 커밋은 서버 로컬 저장소에만 남는다(2026-10-09) — 원격 전송은 별도 `axis-share.push` 가 맡는다.
 * 커밋 직후 올릴 것이 남아 있으면 "지금 push" 를 한 번 권한다(자동으로 올리지는 않는다).
 *
 * 순서: 아이덴티티 확인 → 커밋 대상 정하기 → 메시지 입력 → 서버 커밋.
 * 메시지를 먼저 받지 않는 이유는 "대상 정하기" 가 "전체 커밋" 확인 모달을 띄울 수 있어서다 —
 * 모달에서 취소하면 방금 친 메시지가 버려져 헛수고가 된다.
 */
export async function commitInteractive(): Promise<void> {
    const session = getSession();
    const branch = getCurrentBranch();
    if (!session || !branch) {
        void vscode.window.showWarningMessage('저장소에 연결되어 있지 않습니다. 앱에서 저장소를 연결해 주세요.');
        return;
    }

    if (committing || remoteCommitting) {
        void vscode.window.showWarningMessage('Axis Share: 커밋이 진행 중입니다. 끝난 뒤 다시 시도해 주세요.');
        return;
    }

    const identity = readIdentity();
    if (identity.name.length === 0 || identity.email.length === 0) {
        const pick = await vscode.window.showWarningMessage(
            'Axis Share: 커밋하려면 user.name / user.email 을 먼저 설정해야 합니다.',
            '설정 열기'
        );
        if (pick === '설정 열기') {
            await showIdentitySettings();
        }
        return;
    }

    const paths = await resolveCommitPaths();
    if (paths === undefined) {
        return; // 취소했거나 커밋할 변경이 없다.
    }

    const message = await vscode.window.showInputBox({
        title: 'Axis Share: 커밋 메시지',
        prompt: `${branch} 브랜치에 커밋합니다. 업무 코드(WI-101)를 넣으면 업무 상태가 자동 전환됩니다.`,
        placeHolder: COMMIT_PLACEHOLDER,
        ignoreFocusOut: true,
        validateInput: (value) => (value.trim().length === 0 ? '커밋 메시지를 입력해 주세요.' : undefined)
    });
    if (message === undefined || message.trim().length === 0) {
        return; // 사용자가 취소했다.
    }

    committing = true;
    commitStateEmitter.fire();
    try {
        const rows = await apiRequest<CommitResultRow[]>('/github/repos/commits', {
            method: 'POST',
            body: { repo_id: session.repoId, branch, message: message.trim(), paths, identity }
        });
        reportCommitResult(Array.isArray(rows) ? rows[0] : undefined);
        await refreshStatus();
        commitListEmitter.fire(); // 새 커밋이 생겼다 — Graph 뷰를 다시 받는다(§15.14).
        await offerPushAfterCommit();
    } catch (error) {
        showError('커밋하지 못했습니다.', error);
    } finally {
        committing = false;
        commitStateEmitter.fire();
    }
}

/**
 * 커밋할 경로를 정한다(§15.7).
 * 스테이징된 파일이 있으면 그 파일들만 커밋한다 — 서버는 커밋 시점에 그 경로를 다시 `git add` 하므로
 * 스테이징 뒤에 친 내용도 빠지지 않는다(§12.11). 스테이징이 없으면 전체 커밋을 확인받는다.
 * `undefined` 는 "커밋하지 않는다" 는 뜻이다.
 */
async function resolveCommitPaths(): Promise<string[] | undefined> {
    const staged = unique(statusEntries.filter((entry) => entry.staged).map((entry) => entry.path));
    if (staged.length > 0) {
        return staged;
    }

    const all = unique(statusEntries.map((entry) => entry.path));
    if (all.length === 0) {
        void vscode.window.showInformationMessage('Axis Share: 커밋할 변경 사항이 없습니다.');
        return undefined;
    }

    const answer = await vscode.window.showWarningMessage(
        'Axis Share: 스테이징된 변경이 없습니다. 변경된 파일 전체를 커밋할까요?',
        { modal: true },
        '전체 커밋'
    );
    return answer === '전체 커밋' ? all : undefined;
}

/**
 * 커밋 결과를 사용자에게 알린다(§12.11 — 업무 매칭 결과와 남은 push 대기 수를 함께 보여 준다).
 * 커밋은 로컬에만 남으므로 push 실패를 여기서 다루지 않는다 — push 결과는 `reportPushResult` 가 맡는다.
 */
function reportCommitResult(row: CommitResultRow | undefined): void {
    const shortSha = typeof row?.sha === 'string' ? row.sha.slice(0, 8) : '';
    const head = shortSha ? `${shortSha} 커밋됨` : '커밋했습니다';
    const workItem = row ? describeWorkItem(row) : '';

    const ahead = typeof row?.ahead === 'number' ? row.ahead : syncInfo.ahead;
    const pending = ahead > 0 ? ` (원격에 아직 ${ahead}개)` : '';
    void vscode.window.showInformationMessage(`Axis Share: ${head}${pending}${workItem}.`);
}

/**
 * 커밋 직후 push 를 권한다(§15.7). 자동으로 올리지 않는 이유는 "로컬에만 쌓아 두기" 를 허용하기 위해서다 —
 * 사용자가 "지금 push" 를 고를 때만 원격으로 보낸다.
 */
async function offerPushAfterCommit(): Promise<void> {
    const ahead = syncInfo.ahead;
    if (ahead <= 0) {
        return;
    }

    const answer = await vscode.window.showInformationMessage(
        `Axis Share: 원격에 아직 ${ahead}개 커밋이 있습니다. 지금 push 할까요?`,
        '지금 push'
    );
    if (answer === '지금 push') {
        await pushBranch();
    }
}

function describeWorkItem(row: CommitResultRow): string {
    const displayId = typeof row.matched_display_id === 'number' ? `WI-${row.matched_display_id}` : undefined;
    if (!displayId) {
        return '';
    }

    const transition = row.status_transition;
    const change = transition?.applied ? ` ${transition.from} → ${transition.to}` : '';
    return ` · 업무 ${displayId}${change}`;
}

// ---------------------------------------------------------------------------
// 상태 조회
// ---------------------------------------------------------------------------

/** 서버에서 작업 트리 상태를 받아 뷰·배지를 다시 그린다(§3.2). Changes 뷰 새로 고침도 이 함수를 쓴다. */
export async function refreshStatus(): Promise<void> {
    const session = getSession();
    const branch = getCurrentBranch();
    if (!session || !branch) {
        clearStatus();
        return;
    }

    const key = `${session.repoId}|${branch}`;
    statusKey = key;

    try {
        const rows = await apiRequest<RepoStatusEntry[]>(
            `/github/repos/status?repo_id=${session.repoId}&branch=${encodeURIComponent(branch)}`
        );
        if (statusKey !== key) {
            return; // 그 사이 저장소·브랜치가 바뀌었다 — 낡은 응답은 버린다.
        }

        lastStatusError = undefined;
        setStatus(Array.isArray(rows) ? rows.filter(isStatusEntry) : []);
        void refreshSync(key);
    } catch (error) {
        if (statusKey !== key) {
            return;
        }

        setStatus([]);
        const message = describe(error);
        if (message !== lastStatusError) {
            lastStatusError = message;
            // 뷰 문구 자리는 커밋 안내가 쓰고 있다 — 조회 실패는 알림으로만 남긴다(§15.12).
            void vscode.window.showWarningMessage(`Axis Share: 작업 트리 상태를 불러오지 못했습니다. ${message}`);
        }
    }
}

function clearStatus(): void {
    // 브랜치·저장소가 바뀌었다 — 이전 브랜치의 worktree 알림이 뒤늦게 돌지 않게 취소한다(§9.9).
    cancelWorktreeRefresh();
    statusKey = undefined;
    syncInfo = { has_upstream: false, ahead: 0, behind: 0 };
    setStatus([]);
}

/** 상태를 갈아 끼우고 색인·배지를 한 번에 다시 그린다. */
function setStatus(entries: readonly RepoStatusEntry[]): void {
    statusEntries = entries;
    statusByUri = buildUriIndex(entries);
    statusEmitter.fire();
}

/**
 * 원격 대비 위치를 받아 온다(§3.2 sync). 상태 조회와 함께 불러 push 버튼·뱃지를 맞춘다.
 * 보조 정보라 실패해도 알림을 띄우지 않는다 — 상태 조회 자체는 이미 성공했다.
 */
async function refreshSync(key: string): Promise<void> {
    const session = getSession();
    const branch = getCurrentBranch();
    if (!session || !branch) {
        return;
    }

    try {
        const rows = await apiRequest<SyncInfo[]>(
            `/github/repos/sync?repo_id=${session.repoId}&branch=${encodeURIComponent(branch)}`
        );
        if (statusKey !== key) {
            return; // 그 사이 저장소·브랜치가 바뀌었다 — 낡은 응답은 버린다.
        }
        const info = Array.isArray(rows) ? rows[0] : undefined;
        if (info) {
            setSync(info);
        }
    } catch {
        // sync 실패는 무시한다(위 주석). 다음 조회에서 다시 시도한다.
    }
}

/** 원격 대비 위치를 갈아 끼우고 뷰 뱃지를 다시 그린다. */
function setSync(info: SyncInfo): void {
    syncInfo = {
        has_upstream: info.has_upstream === true,
        head_sha: info.head_sha,
        origin_sha: info.origin_sha,
        ahead: Number.isFinite(info.ahead) ? info.ahead : 0,
        behind: Number.isFinite(info.behind) ? info.behind : 0
    };
    statusEmitter.fire();
}

function buildUriIndex(entries: readonly RepoStatusEntry[]): Map<string, RepoStatusEntry> {
    const index = new Map<string, RepoStatusEntry>();

    const session = getSession();
    const branch = getCurrentBranch();
    if (!session || !branch) {
        return index;
    }

    for (const entry of entries) {
        // 트리·Changes 아이템은 가상 URI(§15.3), 에디터에 열린 문서는 로컬 사본 URI 를 쓰므로 둘 다 넣는다.
        // 같은 경로가 staged/unstaged 두 항목으로 오면(MM 등) 작업 트리 쪽(뒤에 오는 값)이 남는다.
        index.set(repoResourceUri(session.repoId, branch, entry.path).toString(), entry);
        index.set(localCopyUri(session.repoId, branch, entry.path).toString(), entry);
    }

    return index;
}

// ---------------------------------------------------------------------------
// 제어 소켓 이벤트
// ---------------------------------------------------------------------------

/** 제어 소켓이 중계한 커밋 이벤트(§3.3). 같은 저장소·브랜치일 때만 반응한다. */
function onControlEvent(event: ControlEvent): void {
    const session = getSession();
    const branch = getCurrentBranch();
    if (!session || !branch || event.repoId !== session.repoId || event.branch !== branch) {
        return;
    }

    if (event.type === 'commit_started') {
        // 커밋 순서(§12.11) 동안 커밋을 잠근다 — 같은 브랜치에서 두 번 커밋하지 못하게 한다.
        remoteCommitting = true;
        commitStateEmitter.fire();
        return;
    }

    if (event.type === 'worktree_changed') {
        // 같은 브랜치의 누군가(나 포함)가 worktree 파일을 내려썼다 — 변경 목록을 다시 받는다(§9.9, §15.10).
        scheduleWorktreeRefresh();
        return;
    }

    if (event.type === 'commit_finished') {
        remoteCommitting = false;
        commitStateEmitter.fire();
        void refreshStatus(); // 뷰와 파일 배지를 다시 그린다(§15.10).
        commitListEmitter.fire(); // 새 커밋이 생겼다 — Graph 뷰도 다시 받는다(§15.14).
        return;
    }

    if (event.type === 'push_finished') {
        // 같은 브랜치의 다른 사용자가 원격으로 올렸다 — 원격 대비 위치가 바뀌었다(§15.10).
        void refreshStatus();
        commitListEmitter.fire(); // 원격 위치가 바뀌었다 — Graph 뷰도 다시 받는다(§15.14).
    }
}

/**
 * `worktree_changed` 는 파일마다 따로 올 수 있다(같은 브랜치의 여러 편집자). 잠깐 모아 한 번만
 * 다시 조회한다 — 파일 열 개가 동시에 flush 돼도 조회는 한 번이다(§9.9).
 */
const WORKTREE_REFRESH_DEBOUNCE_MS = 300;
let worktreeRefreshTimer: ReturnType<typeof setTimeout> | undefined;

function cancelWorktreeRefresh(): void {
    if (worktreeRefreshTimer) {
        clearTimeout(worktreeRefreshTimer);
        worktreeRefreshTimer = undefined;
    }
}

function scheduleWorktreeRefresh(): void {
    if (worktreeRefreshTimer) {
        clearTimeout(worktreeRefreshTimer);
    }
    worktreeRefreshTimer = setTimeout(() => {
        worktreeRefreshTimer = undefined;
        void refreshStatus();
    }, WORKTREE_REFRESH_DEBOUNCE_MS);
}

// ---------------------------------------------------------------------------
// 유틸
// ---------------------------------------------------------------------------

type CommitIdentity = { name: string; email: string };

/** 커밋 아이덴티티(§1.3-9). `user.email` 은 서버가 계정 이메일과 대조한다(§2.4). */
function readIdentity(): CommitIdentity {
    const config = vscode.workspace.getConfiguration('axis-share');
    return {
        name: (config.get<string>('user.name', '') ?? '').trim(),
        email: (config.get<string>('user.email', '') ?? '').trim()
    };
}

/**
 * 커맨드 인자를 경로 목록으로 편다. 여러 개를 고르면 배열이 섞여 들어온다.
 * Changes 뷰의 인라인 버튼(`view/item/context`)은 항목 객체를 넘기므로 URI 로 되짚는다.
 */
function collectPaths(args: unknown[]): string[] {
    const flat: unknown[] = [];
    for (const arg of args) {
        if (Array.isArray(arg)) {
            flat.push(...arg);
        } else {
            flat.push(arg);
        }
    }

    const paths: string[] = [];
    for (const item of flat) {
        if (!isRecord(item)) {
            continue;
        }

        if (typeof item.path === 'string') {
            paths.push(item.path);
            continue;
        }

        const uri = item.resourceUri;
        if (uri instanceof vscode.Uri) {
            const entry = statusByUri.get(uri.toString());
            if (entry) {
                paths.push(entry.path);
            }
        }
    }

    return unique(paths);
}

function unique(values: readonly string[]): string[] {
    return [...new Set(values)];
}

function isStatusEntry(value: unknown): value is RepoStatusEntry {
    return isRecord(value) && typeof value.path === 'string' && typeof value.state === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function showError(headline: string, error: unknown): void {
    void vscode.window.showErrorMessage(`Axis Share: ${headline} ${describe(error)}`);
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}