import * as vscode from 'vscode';

import { ApiError } from './api';
import { showBranchPicker } from './repo/branchPicker';
import { CONTEXT_HAS_REPO_SESSION, startControlSocket, stopControlSocket } from './repo/controlSocket';
import { createPresenceView } from './repo/presenceProvider';
import { getRepositoryDisplayName, initRepoSession, startSessionFromHandoff } from './repo/repoSession';
import { createRepoTreeView, NO_SESSION_MESSAGE } from './repo/repoTreeProvider';

/**
 * [TASK_11] Axis Share — 서버 로컬 저장소 기반 VSCode 실시간 협업 편집 확장(guest 클라이언트).
 *
 * 구현 기준은 `.antigravitycli/agent/tasks/TASK_11_SERVER_LOCAL_REPO_VSCODE.md` 다.
 * 이 파일은 뷰·커맨드 선언을 등록하고 배선만 한다. 상태는 repoSession(repo/)이 모은다(§15.11).
 *
 * 완료:
 *   src/api.ts                     서버 REST 클라이언트(토큰 인터셉터, §3.5)
 *   src/repo/repoSession.ts        세션 상태·토큰 저장·자동 갱신(§12.1)
 *   src/repo/repoTreeProvider.ts   Repository 트리 — 브랜치별 lazy 조회(§15.3)
 *   src/repo/branchPicker.ts       브랜치 전환·생성·삭제(§15.4)
 *   src/repo/controlSocket.ts      제어 소켓 — presence·브랜치·커밋 이벤트(§3.3)
 *   src/repo/presenceProvider.ts   Editing 뷰 — 브랜치 접속자(§15.5)
 *   src/repo/userColors.ts         사용자 색 배정(§15.8)
 *
 * 다음 단계에서 만들 모듈(§15.11):
 *   src/repo/decorationProvider.ts       Reviews 트리(§15.6)
 *   src/repo/repoFileDecorations.ts      git 상태 배지(FileDecorationProvider)
 *   src/repo/scmProvider.ts              SCM provider(§15.7)
 */

/**
 * 뷰 id 는 각자 자기 모듈이 등록한다 — `axis-share-files`(Repository)는 repoTreeProvider(§15.3),
 * `axis-share-people`(Editing)는 presenceProvider(§15.5). 여기에는 아직 자리표시자인 Reviews 만 남는다.
 */
const VIEW_REVIEWS = 'axis-share-reviews';

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
 * 세션이 서면 repoSession 이벤트로 Repository 트리가 곧바로 다시 그려진다(§15.10).
 * 제어 소켓 연결·collab 티켓은 다음 단계에서 이어 붙인다(§12.2).
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
        const branch = session.defaultBranch ? ` · 브랜치 ${session.defaultBranch}` : '';
        void vscode.window.showInformationMessage(`Axis Share: ${who} 님으로 ${target} 에 연결했습니다${branch}.`);
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
    // 1) 세션 모듈 초기화 — api.ts 에 토큰 공급자를 꽂는다. 저장된 세션은 되살리지 않는다(§12.2):
    //    이 창이 앱의 핸드오프 URI 를 받기 전까지 트리·접속자 뷰는 비어 있다.
    await initRepoSession(context);

    // 2) 뷰 등록(§15.2). Repository·Editing 은 실제 데이터를 그린다. Reviews 는 collab(리뷰 인덱스)이
    //    있어야 하므로 그때까지 자리표시자를 쓴다.
    const repoTree = createRepoTreeView(context);
    createPresenceView(context);
    registerEmptyView(context, VIEW_REVIEWS);

    // 3) 제어 소켓(§3.3). 세션·브랜치 변화를 구독해 스스로 붙고, 방 입장이 끝나면
    //    세션 컨텍스트 키(§15.2)를 켠다 — key 관리도 controlSocket 한 곳에서 한다(§15.10).
    startControlSocket(context);

    // 4) 커맨드 등록(§15.11). 구현한 것만 실제 핸들러를 붙이고 나머지는 자리표시자로 남긴다.
    const implementedCommands: Record<string, () => void> = {
        'axis-share.refresh': () => repoTree.provider.refresh(),
        'axis-share.switchBranch': () => {
            void showBranchPicker();
        }
    };

    for (const commandId of COMMANDS) {
        const handler = implementedCommands[commandId];
        if (handler) {
            context.subscriptions.push(vscode.commands.registerCommand(commandId, handler));
            continue;
        }

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
    // 소켓을 먼저 끊어 서버가 접속자 행을 정리하게 한다(§3.3).
    // 토큰은 남기지만 다음 창이 자동으로 붙지는 않는다 — 다음 창도 앱의 핸드오프로 세션을 세운다(§12.2).
    stopControlSocket();
}
