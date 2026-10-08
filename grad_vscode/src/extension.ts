import * as vscode from 'vscode';

import { ApiError } from './api';
import { getRepositoryDisplayName, initRepoSession, startSessionFromHandoff } from './repo/repoSession';

/**
 * [TASK_11] Axis Share — 서버 로컬 저장소 기반 VSCode 실시간 협업 편집 확장(guest 클라이언트).
 *
 * 구현 기준은 `.antigravitycli/agent/tasks/TASK_11_SERVER_LOCAL_REPO_VSCODE.md` 다.
 * 이 파일은 뷰·커맨드 선언을 등록하고 배선만 한다. 상태는 repoSession(repo/)이 모은다(§15.11).
 *
 * 완료:
 *   src/api.ts                     서버 REST 클라이언트(토큰 인터셉터, §3.5)
 *   src/repo/repoSession.ts        세션 상태·토큰 저장·자동 갱신(§12.1)
 *
 * 다음 단계에서 만들 모듈(§15.11):
 *   src/repo/repoTreeProvider.ts         Repository 트리(§15.3)
 *   src/repo/branchPicker.ts             브랜치 전환·생성·삭제(§15.4)
 *   src/repo/presenceProvider.ts         Editing 트리(§15.5)
 *   src/repo/decorationProvider.ts       Reviews 트리(§15.6)
 *   src/repo/repoFileDecorations.ts      git 상태 배지(FileDecorationProvider)
 *   src/repo/userColors.ts               사용자 색(§15.8)
 *   src/repo/scmProvider.ts              SCM provider(§15.7)
 *   src/repo/controlSocket.ts            제어 소켓(/api/github/ws, §3.3)
 */

const VIEW_FILES = 'axis-share-files';
const VIEW_PEOPLE = 'axis-share-people';
const VIEW_REVIEWS = 'axis-share-reviews';

/**
 * 세션 보유 여부 컨텍스트 키(§15.2). 뷰 안 커맨드의 when 조건이 이 값만 쓴다.
 * 제어 소켓의 `joined` 를 받은 시점에 true 가 된다(§15.10) — 지금은 소켓이 없으므로 항상 false 다.
 */
const CONTEXT_HAS_REPO_SESSION = 'axis-share:hasRepoSession';

const NO_SESSION_MESSAGE = '앱에서 저장소를 연결하고 "VSCode 로 실시간 편집" 을 눌러 주세요.';

/** package.json 에 선언한 커맨드 전체(§15.11, §15.3 컨텍스트 메뉴 포함). */
const COMMANDS: readonly string[] = [
    'axis-share.switchBranch',
    'axis-share.newFile',
    'axis-share.newFolder',
    'axis-share.renameEntry',
    'axis-share.deleteEntry',
    'axis-share.copyPath',
    'axis-share.refresh',
    'axis-share.openFile',
    'axis-share.addDecoration',
    'axis-share.jumpToDecoration',
    'axis-share.deleteDecoration',
    'axis-share.toggleDecorations',
    'axis-share.identitySettings',
    'axis-share.fetch'
];

/**
 * 구현 전 단계의 자리표시자 트리.
 * §15.3 Repository, §15.5 Editing, §15.6 Reviews 는 각각 전용 provider 로 대체된다.
 */
class EmptyTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    public getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    public getChildren(): vscode.TreeItem[] {
        return [];
    }
}

/**
 * 뷰를 등록한다. 세션 전에는 항목 대신 안내 문구만 보여 준다.
 * 컨테이너를 when 으로 통째로 숨기지 않는다(§15.2) — 세션이 끊겼을 때 원인을 알 수 없다.
 */
function registerEmptyView(context: vscode.ExtensionContext, viewId: string): void {
    const view = vscode.window.createTreeView(viewId, {
        treeDataProvider: new EmptyTreeProvider()
    });

    view.message = NO_SESSION_MESSAGE;
    context.subscriptions.push(view);
}

/**
 * 커맨드를 자리표시자로 등록한다.
 * 매니페스트에 선언만 하고 등록하지 않으면 팔레트/메뉴에서 "command not found" 가 난다.
 */
function registerStubCommand(context: vscode.ExtensionContext, commandId: string): void {
    context.subscriptions.push(
        vscode.commands.registerCommand(commandId, (..._args: unknown[]) => {
            void vscode.window.showInformationMessage(
                `Axis Share: '${commandId}' 는 아직 구현되지 않았습니다 (TASK_11 §15).`
            );
            return undefined;
        })
    );
}

/** 쿼리 문자열 → 양의 정수. 없거나 형식이 틀리면 undefined. */
function toPositiveInt(value: string | null): number | undefined {
    if (!value) {
        return undefined;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * 핸드오프 URI 수신(§3.4).
 *
 * 앱이 여는 형태: vscode://junjunshim.axis-share/auth?repo=<repo_id>&node=<node_id>&code=<1회용>
 * 토큰은 URI 로 오지 않는다. 1회용 코드만 오고, 확장이 서버와 교환한다(§12.1).
 * 제어 소켓 연결·collab 티켓·트리 조회는 다음 단계에서 이어 붙인다(§12.2).
 */
async function handleHandoffUri(uri: vscode.Uri): Promise<void> {
    if (uri.path !== '/auth') {
        return;
    }

    const params = new URLSearchParams(uri.query);
    const code = params.get('code');
    if (!code) {
        void vscode.window.showWarningMessage(
            'Axis Share: 핸드오프 URI 에 연결 코드가 없습니다. 앱에서 다시 시도해 주세요.'
        );
        return;
    }

    try {
        const session = await startSessionFromHandoff({
            code,
            repoId: toPositiveInt(params.get('repo')),
            nodeId: toPositiveInt(params.get('node'))
        });

        const who = session.userName ? `${session.userName} (${session.userEmail})` : session.userEmail;
        // 저장소 이름을 못 받았을 때만 id 로 대체한다(§3.2 조회 실패·권한 없음).
        const target = getRepositoryDisplayName(session) ?? `저장소 ${session.repoId}`;
        void vscode.window.showInformationMessage(
            `Axis Share: ${who} 님으로 ${target} 에 연결했습니다. 저장소 구조는 다음 단계에서 표시됩니다.`
        );
    } catch (error) {
        // 서버가 코드를 준 실패(P0811 코드 무효·만료, P0812 세션 만료)는 원인이 분명하므로 문구를 그대로 쓴다.
        if (error instanceof ApiError && error.code !== undefined) {
            void vscode.window.showWarningMessage(`Axis Share: ${error.message}`);
            return;
        }

        void vscode.window.showErrorMessage(
            `Axis Share에서 세션을 시작하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    // 1) 세션 모듈 초기화 — 저장된 토큰/세션을 읽고 api.ts 에 토큰 공급자를 꽂는다(§3.5, §12.1).
    await initRepoSession(context);

    // 2) 뷰 3개 등록(§15.2).
    for (const viewId of [VIEW_FILES, VIEW_PEOPLE, VIEW_REVIEWS]) {
        registerEmptyView(context, viewId);
    }

    // 3) 세션 컨텍스트 키(§15.2). 제어 소켓의 join 이 성공해야 true 가 된다(§15.10 — 소켓 단계).
    void vscode.commands.executeCommand('setContext', CONTEXT_HAS_REPO_SESSION, false);

    // 4) 커맨드 등록(§15.11).
    for (const commandId of COMMANDS) {
        registerStubCommand(context, commandId);
    }

    // 5) 핸드오프 URI 수신(§3.4). activationEvents 의 onUri 가 이 경로로 확장을 깨운다.
    context.subscriptions.push(
        vscode.window.registerUriHandler({
            handleUri(uri: vscode.Uri): void {
                void handleHandoffUri(uri);
            }
        })
    );
}

export function deactivate(): void {
    // 전역 상태를 두지 않는다. 소켓·세션 정리는 repoSession 구현이 담당한다.
}