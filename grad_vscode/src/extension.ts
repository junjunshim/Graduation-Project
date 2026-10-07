import * as vscode from 'vscode';

/**
 * [TASK_11] Axis Share — 서버 로컬 저장소 기반 VSCode 실시간 협업 편집 확장(guest 클라이언트).
 *
 * 이 파일은 뼈대다. 실제 동작은 `.antigravitycli/agent/tasks/TASK_11_SERVER_LOCAL_REPO_VSCODE.md`
 * 를 그대로 따라 구현한다. 뷰·커맨드는 이미 package.json 에 선언되어 있으므로 여기서는
 * "선언된 것을 등록만" 하고, 로직은 다음 단계에서 채운다.
 *
 * 다음 단계에서 만들 모듈(§15.11):
 *   src/api.ts                           서버 REST 클라이언트(토큰 인터셉터)
 *   src/repo/repoTreeProvider.ts         Repository 트리(§15.3)
 *   src/repo/branchPicker.ts             브랜치 전환·생성·삭제(§15.4)
 *   src/repo/presenceProvider.ts         Editing 트리(§15.5)
 *   src/repo/decorationProvider.ts       Reviews 트리(§15.6)
 *   src/repo/repoFileDecorations.ts      git 상태 배지(FileDecorationProvider)
 *   src/repo/userColors.ts               사용자 색(§15.8)
 *   src/repo/repoSession.ts              세션 상태 + 소켓 이벤트 배선(§15.10)
 *   src/repo/scmProvider.ts              SCM provider(§15.7)
 */

const VIEW_FILES = 'axis-share-files';
const VIEW_PEOPLE = 'axis-share-people';
const VIEW_REVIEWS = 'axis-share-reviews';

/** 세션 보유 여부 컨텍스트 키(§15.2). 뷰 안 커맨드의 when 조건이 이 값을 쓴다. */
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

/**
 * 핸드오프 URI 수신(§3.4).
 *
 * 앱이 여는 형태: vscode://junjunshim.axis-share/auth?repo=<repo_id>&node=<node_id>&code=<1회용>
 * 토큰은 URI 로 오지 않는다. 1회용 코드만 오고, 확장이 서버와 교환한다.
 */
async function handleHandoffUri(uri: vscode.Uri): Promise<void> {
    if (uri.path !== '/auth') {
        return;
    }

    const params = new URLSearchParams(uri.query);
    const code = params.get('code');
    const repoId = params.get('repo');
    const nodeId = params.get('node');

    if (!code || !repoId) {
        void vscode.window.showWarningMessage('Axis Share: 핸드오프 URI 에 repo 또는 code 가 없습니다.');
        return;
    }

    // TODO(§3.4, §12.1): 다음 순서로 이어 붙인다.
    //   1) POST /api/github/sessions { code } → access/refresh token 교환
    //      → context.secrets 에 axis-share.at / axis-share.rt 로 저장 (grad-at/grad-rt 는 쓰지 않는다)
    //   2) wss://<host>/api/github/ws 에 JWT 로 붙어 join(repo, branch)  ← 제어 소켓
    //   3) POST /api/collab/tickets 로 1회용 티켓을 받아 wss://<host>/collab/?ticket=... 연결
    //   4) 트리·Editing·Reviews 초기 조회 후 axis-share:hasRepoSession 을 true 로 설정
    void vscode.window.showInformationMessage(
        `Axis Share: 저장소 ${repoId} (node ${nodeId ?? '-'}) 핸드오프를 받았습니다. 세션 연결은 다음 단계에서 구현됩니다.`
    );
}

export function activate(context: vscode.ExtensionContext): void {
    // 1) 뷰 3개 등록(§15.2).
    for (const viewId of [VIEW_FILES, VIEW_PEOPLE, VIEW_REVIEWS]) {
        registerEmptyView(context, viewId);
    }

    // 2) 세션 컨텍스트 키(§15.2). 값은 repoSession 모듈이 갱신한다.
    void vscode.commands.executeCommand('setContext', CONTEXT_HAS_REPO_SESSION, false);

    // 3) 커맨드 등록(§15.11).
    for (const commandId of COMMANDS) {
        registerStubCommand(context, commandId);
    }

    // 4) 핸드오프 URI 수신(§3.4). activationEvents 의 onUri 가 이 경로로 확장을 깨운다.
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