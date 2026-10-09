import * as vscode from 'vscode';

import { ApiError } from './api';
import { showBranchPicker } from './repo/branchPicker';
import { createChangesView } from './repo/changesProvider';
import { CONTEXT_HAS_REPO_SESSION, startControlSocket, stopControlSocket } from './repo/controlSocket';
import { startCursorRenderer, stopCursorRenderer } from './repo/cursorRenderer';
import { openRepoFile, startDocSocket, stopDocSocket } from './repo/docSocket';
import { createGraphView } from './repo/graphProvider';
import { createPresenceView } from './repo/presenceProvider';
import { createRepoFileDecorations } from './repo/repoFileDecorations';
import { getRepositoryDisplayName, initRepoSession, startSessionFromHandoff } from './repo/repoSession';
import { createRepoTreeView, NO_SESSION_MESSAGE } from './repo/repoTreeProvider';
import {
    applyStage,
    applyStageAll,
    commitInteractive,
    discardPaths,
    fetchRemote,
    pushBranch,
    refreshStatus,
    showIdentitySettings,
    startRepoStatus,
    stopRepoStatus
} from './repo/repoStatus';

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
 *   src/repo/presenceProvider.ts   Editing 뷰 — 브랜치별 접속자(§15.5)
 *   src/repo/docSocket.ts          문서 소켓 — 파일 열기·Yjs 텍스트 동기화(§12.4, §12.7)
 *   src/repo/cursorRenderer.ts     원격 커서·선택 영역 렌더(§12.8)
 *   src/repo/userColors.ts         사용자 색 배정(§15.8)
 *   src/repo/repoStatus.ts         작업 트리 상태 + 스테이징·커밋(§15.7)
 *   src/repo/repoFileDecorations.ts git 상태 파일 배지(§15.3)
 *   src/repo/changesProvider.ts    Changes 뷰 — 작업 트리 상태 + 커밋 탭(§15.3)
 *   src/repo/graphProvider.ts      Graph 뷰 — 커밋 현황과 원격 위치(§15.14)
 *
 * 다음 단계에서 만들 모듈(§15.11):
 *   src/repo/decorationProvider.ts       Reviews 트리(§15.6)
 */

/**
 * 뷰 id 는 각자 자기 모듈이 등록한다 — `axis-share-files`(Repository)는 repoTreeProvider(§15.3),
 * `axis-share-people`(Editing)는 presenceProvider(§15.5). 여기에는 아직 자리표시자인 Reviews 만 남는다.
 */
const VIEW_REVIEWS = 'axis-share-reviews';

/** package.json 에 선언한 커맨드 전체(§15.11, §15.3 컨텍스트 메뉴 포함). */
const COMMANDS: readonly string[] = [
    'axis-share.switchBranch',
    'axis-share.stage',
    'axis-share.unstage',
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
    'axis-share.fetch',
    'axis-share.commit',
    'axis-share.push',
    'axis-share.stageAll',
    'axis-share.unstageAll',
    'axis-share.discard'
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
    createChangesView(context);
    const graphView = createGraphView(context);
    createPresenceView(context);
    registerEmptyView(context, VIEW_REVIEWS);

    // 3) 제어 소켓(§3.3). 세션·브랜치 변화를 구독해 스스로 붙고, 방 입장이 끝나면
    //    세션 컨텍스트 키(§15.2)를 켠다 — key 관리도 controlSocket 한 곳에서 한다(§15.10).
    startControlSocket(context);

    // 3-1) 문서 소켓(§12.4). 파일 열기와 실시간 텍스트 동기화를 맡는다. 세션·브랜치가 바뀌면
    //      스스로 접고, 다음 파일 열기에서 새 방으로 다시 붙는다(§10.3).
    startDocSocket(context);

    // 3-2) 원격 커서 렌더러(§12.8). 문서 소켓이 중계한 상대 좌표를 각자의 Y.Doc 에서 풀어 화면에 그린다.
    //      좌표 해석은 클라이언트만 할 수 있으므로 서버(collab)는 손대지 않는다(§8.10).
    startCursorRenderer(context);

    // 3-3) 작업 트리 상태(§15.7). Changes 뷰와 파일 배지가 함께 읽는 상태를 여기서 한 번만 조회한다.
    //      네이티브 소스 제어(SCM)는 쓰지 않는다 — 상태도 커밋도 Changes 뷰 한 곳에서 다룬다(§15.7).
    startRepoStatus(context);

    // 3-4) 파일 상태 배지(§15.3). Repository 트리와 Changes 뷰 아이템에 같은 배지를 붙인다.
    createRepoFileDecorations(context);

    // 4) 커맨드 등록(§15.11). 구현한 것만 실제 핸들러를 붙이고 나머지는 자리표시자로 남긴다.
    const implementedCommands: Record<string, (...args: unknown[]) => void> = {
        // 새로 고침은 트리와 작업 트리 상태(Changes)를 함께 다시 받는다.
        'axis-share.refresh': () => {
            repoTree.provider.refresh();
            graphView.provider.refresh();
            void refreshStatus();
        },
        'axis-share.switchBranch': () => {
            void showBranchPicker();
        },
        'axis-share.openFile': (entry?: unknown) => {
            void openRepoFile(entry);
        },
        // Changes 뷰 아이템의 인라인 $(add)/$(remove) 와 컨텍스트 메뉴가 부른다(§15.7).
        'axis-share.stage': (...args: unknown[]) => {
            void applyStage(true, args);
        },
        'axis-share.unstage': (...args: unknown[]) => {
            void applyStage(false, args);
        },
        // Changes 뷰 타이틀의 $(add)/$(remove) — 현재 브랜치의 모든 변경을 한 번에 옮긴다.
        'axis-share.stageAll': () => {
            void applyStageAll(true);
        },
        'axis-share.unstageAll': () => {
            void applyStageAll(false);
        },
        // Changes 뷰 아이템의 인라인 $(discard) — 수정한 내용을 이전 상태로 되돌린다(§12.11.1).
        'axis-share.discard': (...args: unknown[]) => {
            void discardPaths(args);
        },
        // Changes 뷰 타이틀의 $(check). 메시지 입력은 이 커맨드가 직접 띄운다(§15.7).
        'axis-share.commit': () => {
            void commitInteractive();
        },
        // Changes 뷰 타이틀의 $(cloud-upload). 커밋한 내용을 원격으로 올린다(§12.11 — 커밋과 분리).
        'axis-share.push': () => {
            void pushBranch();
        },
        // Changes 뷰 타이틀의 ⚙ / ⟳ (§15.7).
        'axis-share.identitySettings': () => {
            void showIdentitySettings();
        },
        'axis-share.fetch': () => {
            void fetchRemote();
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
    stopDocSocket();
    stopCursorRenderer();
    stopRepoStatus();
}
