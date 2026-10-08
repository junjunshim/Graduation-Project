import * as vscode from 'vscode';

import { ApiError, apiRequest, setAccessTokenProvider } from '../api';

/**
 * [TASK_11 §12.1] 확장 편집 세션의 상태와 생명주기.
 *
 * 확장은 사용자 비밀번호를 다루지 않는다. 앱이 넘긴 1회용 핸드오프 코드를 자기 토큰으로 교환하고,
 * 그 뒤로는 스스로 갱신한다 — 앱이 꺼져 있어도 재접속이 되게 하기 위해서다(§12.1).
 *
 * 저장 위치를 둘로 나눈 이유:
 *   - 토큰 → context.secrets. 창 상태·설정과 함께 평문으로 저장되지 않는다.
 *   - 나머지 → context.globalState. 마지막 세션 기록(연결 이력·표시용).
 *
 * 세션은 **창마다 새로 부착(attach)한다.** activate 는 저장된 세션을 되살리지 않는다.
 * 화면과 서버 연결은 이 창이 앱의 핸드오프 URI 를 받아 세션을 세운 뒤에야 살아난다 —
 * 그래야 F5·창 재로드에서 지난 연결의 내용이 그대로 남지 않는다(§12.2).
 */

/** 시크릿 키. 삭제된 이전 확장의 grad-at/grad-rt 는 승계하지 않는다(§3.4). */
const ACCESS_TOKEN_KEY = 'axis-share.at';
const REFRESH_TOKEN_KEY = 'axis-share.rt';

/** globalState 키 — 저장소·사용자 정보. */
const SESSION_STATE_KEY = 'axis-share.session';

/** 만료 임박 판정 여유분. 왕복 중에 만료되는 것을 막는다. */
const REFRESH_MARGIN_MS = 60_000;

/** 기본 access token 수명(초). 서버가 expires_in 을 주지 않았을 때만 쓴다. */
const DEFAULT_EXPIRES_IN_SECONDS = 3_600;

/** POST /api/github/sessions 응답 항목(§3.2). */
type SessionTokenItem = {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    user_email?: string;
    user_name?: string;
    node_id?: number;
    repo_id?: number;
};

/** POST /api/github/sessions/refresh 응답 항목(§3.2). */
type RefreshedTokenItem = {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
};

/** GET /api/github/repos 응답 행 중 확장이 쓰는 필드(§3.2). `node_id` 가 필수 파라미터다. */
type RepositoryRow = {
    repo_id?: number;
    owner_login?: string;
    repo_name?: string;
    default_branch?: string;
};

/** 세션에 붙일 저장소 정보. 이름은 표시용, 기본 브랜치는 트리 조회의 시작점이다(§15.3). */
export type RepositoryIdentity = {
    ownerLogin?: string;
    repoName?: string;
    defaultBranch?: string;
};

/** 현재 세션. 토큰 자체는 담지 않는다 — 토큰은 secrets 에만 있다. */
export type RepoSession = {
    repoId: number;
    nodeId?: number;
    userEmail: string;
    userName?: string;
    /**
     * 저장소 표시 이름(`owner/repo`). 세션 교환 응답에 없어서 따로 조회해 붙인다.
     * 조회에 실패하면 비고, 화면은 저장소 id 로 대체한다.
     */
    ownerLogin?: string;
    repoName?: string;
    /** 저장소 기본 브랜치. 트리 조회의 시작 브랜치다(§15.3). */
    defaultBranch?: string;
    /** access token 만료 시각(epoch ms). 이 시각이 지나면 먼저 갱신한다. */
    accessTokenExpiresAt: number;
};

export type HandoffParams = {
    /** 앱이 발급한 1회용 코드(60초). URI 로만 오고 토큰은 오지 않는다(§3.4). */
    code: string;
    /** 핸드오프 URI 의 repo/node. 서버 응답에 값이 없을 때만 쓰는 보조값이다. */
    repoId?: number;
    nodeId?: number;
};

let extensionContext: vscode.ExtensionContext | undefined;
let session: RepoSession | undefined;

/** 동시 요청이 겹쳐도 토큰 회전은 한 번만 일어나게 합친다 — 리프레시 토큰은 1회용이다(§12.1). */
let refreshInFlight: Promise<boolean> | undefined;

/**
 * 현재 작업 브랜치. 저장소를 연결하면 기본 브랜치로 시작하고, 브랜치 전환(§15.4)이 바꾼다.
 * 트리·상태·커밋이 모두 이 값을 보므로 세션과 함께 여기서 관리한다.
 */
let currentBranch: string | undefined;

const sessionChangeEmitter = new vscode.EventEmitter<void>();

/** 세션·브랜치 변경 알림. 뷰들(Repository 트리·Changes)이 이 이벤트로 다시 그린다(§15.10). */
export const onDidChangeSession = sessionChangeEmitter.event;

function emitSessionChange(): void {
    sessionChangeEmitter.fire();
}

/** 현재 세션(없으면 undefined). 다음 단계(제어 소켓·파일 조회)가 저장소 맥락으로 쓴다. */
export function getSession(): RepoSession | undefined {
    return session;
}

/** 현재 작업 브랜치. 세션 전이면 undefined. */
export function getCurrentBranch(): string | undefined {
    return currentBranch;
}

/** 브랜치를 전환한다(§15.4). 열린 파일 정리·문서 탭 정리는 전환 절차를 맡는 쪽이 한다(§10.3). */
export function setCurrentBranch(branch: string | undefined): void {
    if (currentBranch === branch) {
        return;
    }

    currentBranch = branch;
    emitSessionChange();
}

/** 저장소 id(1-based). 세션이 없으면 undefined. */
export function getSessionRepoId(): number | undefined {
    return session?.repoId;
}

/**
 * 세션 모듈을 초기화한다. activate 에서 한 번 부른다.
 * 같은 컨텍스트로 다시 불러도 하는 일이 없어 무해하다(멱등).
 *
 * **저장된 세션을 되살리지 않는다.** 이 창은 "미부착" 상태로 시작하고, 앱이 보낸
 * 핸드오프 URI(startSessionFromHandoff)로만 세션이 선다(§12.2). 그래서 앱을 거치지 않은
 * F5·창 재로드에서는 트리·접속자 뷰가 비어 있고 서버로 나가는 요청도 없다.
 */
export async function initRepoSession(context: vscode.ExtensionContext): Promise<void> {
    if (extensionContext && extensionContext === context) {
        return;
    }

    extensionContext = context;
    session = undefined;
    currentBranch = undefined;

    // api.ts 는 세션을 몰라야 하므로(순환 참조) 토큰 공급자를 여기서 꽂는다.
    setAccessTokenProvider(getValidAccessToken);
}

function requireContext(): vscode.ExtensionContext {
    if (!extensionContext) {
        throw new Error('Axis Share: 세션 모듈이 초기화되지 않았습니다.');
    }

    return extensionContext;
}

function toExpiresAt(expiresIn?: number): number {
    const seconds = expiresIn && expiresIn > 0 ? expiresIn : DEFAULT_EXPIRES_IN_SECONDS;
    return Date.now() + seconds * 1000;
}

/**
 * 토큰을 secrets 에 넣고 현재 세션을 교체한다.
 * 이어지는 조회가 이미 새 토큰을 쓰도록 globalState 반영(persistSession)보다 먼저 부른다.
 */
async function storeTokens(accessToken: string, refreshToken: string, next: RepoSession): Promise<void> {
    const context = requireContext();
    await context.secrets.store(ACCESS_TOKEN_KEY, accessToken);
    await context.secrets.store(REFRESH_TOKEN_KEY, refreshToken);
    session = next;
}

/** 마지막 세션을 globalState 에 남긴다(연결 이력·표시용). 다음 창이 자동으로 붙지는 않는다 — 부착은 핸드오프로만(§12.2). */
async function persistSession(next: RepoSession): Promise<void> {
    const repoChanged = session?.repoId !== next.repoId;
    session = next;

    // 저장소가 바뀌었거나 아직 브랜치가 없을 때만 기본 브랜치로 맞춘다.
    // (토큰 갱신도 이 함수를 지나므로, 사용자가 고른 브랜치를 덮어쓰면 안 된다.)
    if (currentBranch === undefined || repoChanged) {
        currentBranch = next.defaultBranch;
    }

    await requireContext().globalState.update(SESSION_STATE_KEY, next);
    emitSessionChange();
}

/**
 * 저장소 표시 이름을 조회한다(§3.2 `GET /api/github/repos`).
 * 세션 교환 응답에 이름이 없어서 한 번 더 받아 온다. 표시용 정보라 실패해도 연결은 유지한다.
 */
async function fetchRepositoryIdentity(repoId: number, nodeId?: number): Promise<RepositoryIdentity | undefined> {
    if (nodeId === undefined) {
        return undefined;
    }

    try {
        const rows = await apiRequest<RepositoryRow[]>(`/github/repos?node_id=${nodeId}`);
        const row = Array.isArray(rows) ? rows.find((item) => item.repo_id === repoId) : undefined;
        if (!row) {
            return undefined;
        }

        return { ownerLogin: row.owner_login, repoName: row.repo_name, defaultBranch: row.default_branch };
    } catch {
        // 조회 실패·권한 없음이 연결을 막지는 않는다. 이름이 없으면 화면이 저장소 id 로 대체한다.
        return undefined;
    }
}

/** `owner/repo` 표시 이름. 이름을 못 받았으면 undefined — 호출부가 저장소 id 로 대체한다. */
export function getRepositoryDisplayName(target?: RepoSession): string | undefined {
    if (!target?.repoName) {
        return undefined;
    }

    return target.ownerLogin ? `${target.ownerLogin}/${target.repoName}` : target.repoName;
}

/**
 * 1회용 코드를 확장 전용 토큰으로 교환하고 세션을 시작한다(§3.4, §12.1).
 * 실패하면 ApiError(P0811 = 코드 무효·만료·재사용)를 그대로 올린다 — 앱에서 다시 열어야 하는 상태다.
 */
export async function startSessionFromHandoff(handoff: HandoffParams): Promise<RepoSession> {
    const items = await apiRequest<SessionTokenItem[]>('/github/sessions', {
        method: 'POST',
        body: { code: handoff.code },
        includeToken: false
    });

    const item = Array.isArray(items) ? items[0] : undefined;
    if (!item?.access_token || !item?.refresh_token || !item?.user_email) {
        throw new ApiError('확장 세션 응답 형식이 올바르지 않습니다. 앱에서 다시 시도해 주세요.');
    }

    // 저장소 id 는 서버 응답이 권위다. 응답에 없을 때만 URI 값을 쓴다.
    const repoId = typeof item.repo_id === 'number' ? item.repo_id : handoff.repoId;
    if (repoId === undefined) {
        throw new ApiError('핸드오프 정보에 저장소 id 가 없습니다. 앱에서 다시 시도해 주세요.');
    }

    const next: RepoSession = {
        repoId,
        nodeId: typeof item.node_id === 'number' ? item.node_id : handoff.nodeId,
        userEmail: item.user_email,
        userName: item.user_name,
        accessTokenExpiresAt: toExpiresAt(item.expires_in)
    };

    await storeTokens(item.access_token, item.refresh_token, next);

    // 이름은 표시용이라 못 받아도 그대로 진행한다. 토큰이 이미 저장돼 있어 이 조회에 인증이 실린다.
    const identity = await fetchRepositoryIdentity(next.repoId, next.nodeId);
    const started: RepoSession = identity ? { ...next, ...identity } : next;

    await persistSession(started);
    return started;
}

/**
 * 리프레시 토큰으로 새 토큰 세트를 받는다(§12.1). 성공 여부만 돌려준다.
 * P0812(만료·이미 회전됨)면 세션을 버린다 — 그 토큰으로는 더 이상 갱신할 수 없다.
 */
export async function refreshSessionTokens(): Promise<boolean> {
    if (refreshInFlight) {
        return refreshInFlight;
    }

    refreshInFlight = performRefresh().finally(() => {
        refreshInFlight = undefined;
    });

    return refreshInFlight;
}

async function performRefresh(): Promise<boolean> {
    const context = requireContext();
    const current = session;
    const refreshToken = await context.secrets.get(REFRESH_TOKEN_KEY);
    if (!current || !refreshToken) {
        return false;
    }

    try {
        const items = await apiRequest<RefreshedTokenItem[]>('/github/sessions/refresh', {
            method: 'POST',
            body: { refresh_token: refreshToken },
            includeToken: false
        });

        const item = Array.isArray(items) ? items[0] : undefined;
        if (!item?.access_token || !item?.refresh_token) {
            return false;
        }

        const refreshed: RepoSession = { ...current, accessTokenExpiresAt: toExpiresAt(item.expires_in) };
        await storeTokens(item.access_token, item.refresh_token, refreshed);
        await persistSession(refreshed);
        return true;
    } catch (error) {
        // 회전 실패는 되돌릴 수 없다(리프레시 토큰은 1회용). 세션을 지워 다시 연결하도록 만든다.
        if (error instanceof ApiError && (error.code === 'P0812' || error.status === 401)) {
            await clearSession();
        }

        return false;
    }
}

/**
 * api.ts 의 토큰 공급자(요청 인터셉터, §3.5)이자 제어 소켓의 인증 토큰 공급자다(§3.3).
 * 만료가 임박했으면 먼저 갱신한다. 갱신에 실패해도 만료된 토큰을 그대로 넘긴다 —
 * 서버가 401 로 판정하게 두고, "다시 연결" 안내는 호출부가 결정한다(§12.2).
 *
 * 창이 부착되지 않았으면(핸드오프 전·세션 끊김) `undefined` 다. secrets 에 지난 토큰이
 * 남아 있어도 이 창이 세운 세션 없이는 서버로 나가는 요청에 인증이 실리지 않는다(§12.2).
 */
export async function getValidAccessToken(): Promise<string | undefined> {
    if (!session) {
        return undefined;
    }

    const context = requireContext();
    const accessToken = await context.secrets.get(ACCESS_TOKEN_KEY);
    if (!accessToken) {
        return undefined;
    }

    if (!session || Date.now() < session.accessTokenExpiresAt - REFRESH_MARGIN_MS) {
        return accessToken;
    }

    if (await refreshSessionTokens()) {
        return (await context.secrets.get(ACCESS_TOKEN_KEY)) ?? accessToken;
    }

    return accessToken;
}

/** 세션을 버린다 — 로그아웃, 앱에서 연결 해제, 리프레시 토큰 회전 실패(§12.1). */
export async function clearSession(): Promise<void> {
    session = undefined;
    currentBranch = undefined;
    refreshInFlight = undefined;
    emitSessionChange();

    const context = extensionContext;
    if (!context) {
        return;
    }

    await context.secrets.delete(ACCESS_TOKEN_KEY);
    await context.secrets.delete(REFRESH_TOKEN_KEY);
    await context.globalState.update(SESSION_STATE_KEY, undefined);
}