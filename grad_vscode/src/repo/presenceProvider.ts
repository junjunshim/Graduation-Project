import * as vscode from 'vscode';

import {
    getControlState,
    getPresenceByBranch,
    onDidChangeControlState,
    onDidReceiveControlEvent,
    type PresenceEntry
} from './controlSocket';
import { getOpenFilePresence, onDidChangeFilePresence } from './docSocket';
import { getCurrentBranch, getSession, onDidChangeSession } from './repoSession';
import { NO_SESSION_MESSAGE } from './repoTreeProvider';
import { userColor } from './userColors';

/**
 * [TASK_11 §15.5] Editing 뷰 — 어느 브랜치에서 누가 작업 중인가.
 *
 * 데이터 출처는 제어 소켓(C++)의 접속자 목록이다(§12.2). 저장소 전체를 **브랜치별로** 묶어
 * 보여 주고, 뷰 타이틀에 저장소 전체 인원을 적는다 — 다른 브랜치에 사람이 있는지 보려고
 * 브랜치를 옮겨 다니지 않아도 되게 하려는 것이다.
 *
 * 구조는 **브랜치 → 사람 → 그 사람이 보고 있는 파일**이다(§15.5). 사람 아래에 파일을 두면 같은 이름이
 * 파일마다 되풀이되지 않고 "누가 무엇을 보고 있나" 가 한 줄로 읽힌다.
 *
 * 파일 단위 참여자는 문서 소켓의 `opened` / `peer_join` / `peer_leave` 로만 알 수 있고(§9.5), 그 소켓은
 * 이 창이 연 파일만 안다. 그래서 파일 목록은 **문서 소켓이 그 브랜치에 붙어 있을 때**(= 이 창이 파일을
 * 하나라도 연 뒤)만 채워지고, 겹치는 파일이 없는 사람은 이름만 남는다.
 */

const VIEW_PEOPLE = 'axis-share-people';

/** 아직 방에 들어가지 않았을 때의 안내. 소켓 문제와 "정말 아무도 없음" 을 구분한다. */
const WAITING_MESSAGE = '제어 소켓에 연결되면 브랜치별 접속자가 표시됩니다.';

/** 방에 들어갔는데 아무도 없을 때(§15.5 빈 상태). */
const EMPTY_MESSAGE = '이 저장소에서 편집 중인 사용자가 없습니다.';

/**
 * 뷰가 그리는 항목 — 브랜치 그룹 · 사람 · 파일, 세 종류다(§15.5).
 * 접속자 목록은 제어 소켓이(§12.2), 각자가 보고 있는 파일은 문서 소켓이 준다(§9.5).
 */
export type PresenceItem =
    | { kind: 'branch'; branch: string; entries: readonly PresenceEntry[] }
    | { kind: 'person'; entry: PresenceEntry; isMe: boolean; files: readonly string[] }
    | { kind: 'file'; path: string };

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
        if (item.kind === 'branch') {
            return branchTreeItem(item);
        }

        return item.kind === 'file' ? fileTreeItem(item) : personTreeItem(item);
    }

    public getChildren(element?: PresenceItem): PresenceItem[] {
        if (!element) {
            return branchGroups();
        }

        if (element.kind === 'branch') {
            return branchPeople(element.branch, element.entries);
        }

        if (element.kind === 'person') {
            return element.files.map((path) => ({ kind: 'file', path }) as PresenceItem);
        }

        // 파일 항목에는 자식이 없다.
        return [];
    }

    /** 뷰 타이틀 오른쪽의 전체 인원과 안내 문구를 맞춘다(§15.5). */
    private updateViewChrome(): void {
        const view = this.view;
        if (!view) {
            return;
        }

        const joined = getControlState() === 'joined';
        const count = totalPresence();
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

/**
 * 브랜치 그룹 목록. 현재 브랜치를 맨 앞에 두고 나머지는 이름순이다(§15.5) —
 * 지금 보고 있는 브랜치를 먼저 찾게 하려는 것이다. 접속자가 0명인 브랜치는 그리지 않는다.
 */
function branchGroups(): PresenceItem[] {
    const current = getCurrentBranch();
    const groups: PresenceItem[] = [];

    for (const [branch, entries] of getPresenceByBranch()) {
        if (entries.length > 0) {
            groups.push({ kind: 'branch', branch, entries });
        }
    }

    groups.sort((a, b) => {
        if (a.kind !== 'branch' || b.kind !== 'branch') {
            return 0;
        }
        const aCurrent = a.branch === current;
        const bCurrent = b.branch === current;
        if (aCurrent !== bCurrent) {
            return aCurrent ? -1 : 1;
        }
        return a.branch.localeCompare(b.branch);
    });

    return groups;
}

/**
 * 브랜치 그룹의 자식 — 사람 목록(§15.5). 접속자 목록(제어 소켓)을 기준으로 하고, 각자에게 지금
 * 보고 있는 파일(문서 소켓)을 붙인다. 문서 소켓은 이 창이 연 파일만 아니, 겹치는 파일이 없는
 * 사람은 파일 없이 이름만 남는다 — 없는 정보를 지어내지 않는다(§9.5).
 */
function branchPeople(branch: string, entries: readonly PresenceEntry[]): PresenceItem[] {
    const me = getSession()?.userEmail;
    const filesByUser = new Map<string, string[]>();

    for (const file of getOpenFilePresence(branch)) {
        for (const watcher of file.watchers) {
            const files = filesByUser.get(watcher.email);
            if (files) {
                files.push(file.path);
            } else {
                filesByUser.set(watcher.email, [file.path]);
            }
        }
    }

    const people: PresenceItem[] = [];
    const seen = new Set<string>();
    for (const entry of entries) {
        seen.add(entry.email);
        people.push({
            kind: 'person',
            entry,
            isMe: entry.email === me,
            files: filesByUser.get(entry.email) ?? []
        });
    }

    // 접속자 목록에 없는데 문서 소켓에는 보이는 사람(끊김 직후 등)도 빠뜨리지 않는다.
    for (const [email, files] of filesByUser) {
        if (!seen.has(email)) {
            people.push({ kind: 'person', entry: { email }, isMe: email === me, files });
        }
    }

    // 나를 맨 앞에 두고 나머지는 이름순이다(§15.5). 그래야 내가 여는 파일을 먼저 본다.
    people.sort((a, b) => {
        if (a.kind !== 'person' || b.kind !== 'person') {
            return 0;
        }
        if (a.isMe !== b.isMe) {
            return a.isMe ? -1 : 1;
        }
        return displayName(a.entry).localeCompare(displayName(b.entry));
    });

    return people;
}

/** 저장소 전체 접속자 수(브랜치별 인원의 합). 뷰 타이틀에 쓴다. */
function totalPresence(): number {
    let total = 0;
    for (const entries of getPresenceByBranch().values()) {
        total += entries.length;
    }
    return total;
}

/** 브랜치 그룹 한 줄. 접속자가 있는 브랜치만 그리므로 항상 펼칠 수 있다. */
function branchTreeItem(item: Extract<PresenceItem, { kind: 'branch' }>): vscode.TreeItem {
    const current = item.branch === getCurrentBranch();
    const treeItem = new vscode.TreeItem(
        item.branch,
        current ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
    );

    // 항목 id 를 고정해야 다시 그려도 펼침 상태가 유지된다.
    treeItem.id = `branch:${item.branch}`;
    treeItem.description = current ? `${item.entries.length}명 · 현재` : `${item.entries.length}명`;
    treeItem.iconPath = new vscode.ThemeIcon('git-branch');
    treeItem.contextValue = 'axisBranchPresence';
    treeItem.tooltip = `이 브랜치에서 편집 중인 사용자 ${item.entries.length}명`;

    return treeItem;
}

/** 사람 아래의 파일 한 줄(§15.5). 라벨은 파일 이름, `description` 은 디렉터리. 누르면 그 파일을 연다. */
function fileTreeItem(item: Extract<PresenceItem, { kind: 'file' }>): vscode.TreeItem {
    const treeItem = new vscode.TreeItem(basename(item.path), vscode.TreeItemCollapsibleState.None);

    // 항목 id 를 고정해야 다시 그려도 같은 자리를 지킨다.
    treeItem.id = `file:${item.path}`;
    const directory = dirname(item.path);
    if (directory) {
        treeItem.description = directory;
    }
    treeItem.iconPath = new vscode.ThemeIcon('file');
    treeItem.contextValue = 'axisFilePresence';
    treeItem.tooltip = item.path;
    treeItem.command = {
        command: 'axis-share.openFile',
        title: '파일 열기',
        arguments: [{ path: item.path }]
    };

    return treeItem;
}

/** 경로의 마지막 조각(파일 이름). */
function basename(path: string): string {
    const index = path.lastIndexOf('/');
    return index >= 0 ? path.slice(index + 1) : path;
}

/** 경로에서 파일 이름을 뺀 디렉터리. 루트면 빈 문자열이다. */
function dirname(path: string): string {
    const index = path.lastIndexOf('/');
    return index > 0 ? path.slice(0, index) : '';
}

/** 접속자 한 줄. 보고 있는 파일이 있으면 그 아래에 붙는다(§15.5). */
function personTreeItem(item: Extract<PresenceItem, { kind: 'person' }>): vscode.TreeItem {
    const entry = item.entry;
    const collapsible = item.files.length > 0
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.None;
    const treeItem = new vscode.TreeItem(displayName(entry), collapsible);

    // 항목 id 를 고정해야 다시 그려도 펼침 상태가 유지된다.
    treeItem.id = `person:${entry.email}`;
    // 같은 이름이 여럿일 수 있어 이메일을 함께 보여 준다(§15.11 의 axisPerson 컨텍스트 기준).
    const identity = item.isMe ? `${entry.email} · 나` : entry.email;
    treeItem.description = item.files.length > 0 ? `${item.files.length}개 파일 · ${identity}` : identity;
    // 사이드바 점은 원격 커서와 같은 색을 쓴다(§15.8).
    treeItem.iconPath = new vscode.ThemeIcon('circle-filled', userColor(entry.email));
    treeItem.contextValue = 'axisPerson';
    treeItem.tooltip = buildTooltip(entry);

    return treeItem;
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
        }),
        onDidChangeFilePresence(() => provider.refresh())
    );

    return view;
}
