import * as vscode from 'vscode';

import {
    getBranchPresence,
    getControlState,
    onDidChangeControlState,
    onDidReceiveControlEvent,
    type PresenceEntry
} from './controlSocket';
import { getSession, onDidChangeSession } from './repoSession';
import { NO_SESSION_MESSAGE } from './repoTreeProvider';
import { userColor } from './userColors';

/**
 * [TASK_11 §15.5] Editing 뷰 — 지금 이 브랜치에서 작업 중인 사용자.
 *
 * 데이터 출처는 제어 소켓(C++)의 접속자 목록이다(§12.2). §15.5 의 최종 구조는
 * "파일(열려 있는 파일) → 그 파일을 보는 사용자" 인데, 파일 단위 참여자는 문서 소켓(collab)의
 * `opened` / `peer_join` / `peer_leave` 로만 알 수 있다(§9.5). collab 이 붙기 전까지는
 * 브랜치 접속자를 평평한 목록으로 보여 주고, collab 단계에서 파일 그룹 한 단계를 위에 얹는다.
 *
 * 그래서 지금 이 뷰가 답하는 질문은 §1.3-6 쪽이다 — "누가 이 브랜치에서 작업 중인가".
 */

const VIEW_PEOPLE = 'axis-share-people';

/** 아직 방에 들어가지 않았을 때의 안내. 소켓 문제와 "정말 아무도 없음" 을 구분한다. */
const WAITING_MESSAGE = '제어 소켓에 연결되면 이 브랜치의 접속자가 표시됩니다.';

/** 방에 들어갔는데 아무도 없을 때(§15.5 빈 상태). */
const EMPTY_MESSAGE = '이 브랜치에서 편집 중인 사용자가 없습니다.';

/** 뷰가 그리는 항목 1개 = 접속자 1명. */
export type PresenceItem = {
    entry: PresenceEntry;
    /** 내 항목인지. 화면에서 "나" 로 표시한다. */
    isMe: boolean;
};

export class PresenceTreeProvider implements vscode.TreeDataProvider<PresenceItem>, vscode.Disposable {
    private readonly changeEmitter = new vscode.EventEmitter<void>();

    public readonly onDidChangeTreeData = this.changeEmitter.event;

    private view: vscode.TreeView<PresenceItem> | undefined;

    public attachView(view: vscode.TreeView<PresenceItem>): void {
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

    public getTreeItem(item: PresenceItem): vscode.TreeItem {
        const entry = item.entry;
        const treeItem = new vscode.TreeItem(
            displayName(entry),
            vscode.TreeItemCollapsibleState.None
        );

        // 같은 이름이 여럿일 수 있어 이메일을 함께 보여 준다(§15.11 의 axisPerson 컨텍스트 기준).
        treeItem.description = item.isMe ? `${entry.email} · 나` : entry.email;
        // 사이드바 점은 원격 커서와 같은 색을 쓴다(§15.8).
        treeItem.iconPath = new vscode.ThemeIcon('circle-filled', userColor(entry.email));
        treeItem.contextValue = 'axisPerson';
        treeItem.tooltip = buildTooltip(entry);

        return treeItem;
    }

    public getChildren(): PresenceItem[] {
        const me = getSession()?.userEmail;
        return getBranchPresence().map((entry) => ({ entry, isMe: entry.email === me }));
    }

    /** 뷰 타이틀 오른쪽의 접속자 수와 안내 문구를 맞춘다(§15.5). */
    private updateViewChrome(): void {
        const view = this.view;
        if (!view) {
            return;
        }

        const joined = getControlState() === 'joined';
        const count = getBranchPresence().length;
        view.description = count > 0 ? `${count}명 접속` : undefined;

        if (!getSession()) {
            // 저장소를 아직 연결하지 않았다. Repository 뷰와 같은 안내를 쓴다(§15.3).
            view.message = NO_SESSION_MESSAGE;
        } else if (!joined) {
            view.message = WAITING_MESSAGE;
        } else if (count === 0) {
            view.message = EMPTY_MESSAGE;
        } else {
            view.message = undefined;
        }
    }
}

/** 표시 이름. 이름이 없으면 이메일 앞부분으로 대체한다(§15.5 라벨 = userName). */
function displayName(entry: PresenceEntry): string {
    const name = entry.name?.trim();
    if (name) {
        return name;
    }

    return entry.email.split('@')[0] || entry.email;
}

function buildTooltip(entry: PresenceEntry): vscode.MarkdownString {
    const lines = [entry.email];
    const connectedAt = formatTimestamp(entry.connected_at);
    if (connectedAt) {
        lines.push(`접속 ${connectedAt}`);
    }

    return new vscode.MarkdownString(lines.join('  \n'));
}

/**
 * 서버가 보낸 시각 문자열을 화면용으로 바꾼다.
 * PostgreSQL timestamptz 를 Drogon 이 `2026-10-08 12:20:19.436217+00` 형태로 넘기므로
 * 공백을 `T` 로 바꿔 파싱하고, 파싱이 안 되면 원문을 그대로 보여 준다.
 */
function formatTimestamp(value: string | undefined): string | undefined {
    if (!value) {
        return undefined;
    }

    const parsed = new Date(value.replace(' ', 'T'));
    if (Number.isNaN(parsed.getTime())) {
        return value;
    }

    return parsed.toLocaleString('ko-KR');
}

/**
 * Editing 뷰를 만들고 등록한다(§15.2, §15.5).
 * 접속자 목록은 제어 소켓이 밀어 주고(§15.10), 브랜치를 바꾸면 세션 이벤트로 다시 그린다.
 */
export function createPresenceView(context: vscode.ExtensionContext): vscode.TreeView<PresenceItem> {
    const provider = new PresenceTreeProvider();
    const view = vscode.window.createTreeView(VIEW_PEOPLE, {
        treeDataProvider: provider
    });

    provider.attachView(view);
    context.subscriptions.push(
        view,
        provider,
        onDidChangeSession(() => provider.refresh()),
        onDidChangeControlState(() => provider.refresh()),
        onDidReceiveControlEvent((event) => {
            if (event.type === 'presence_updated') {
                provider.refresh();
            }
        })
    );

    return view;
}
