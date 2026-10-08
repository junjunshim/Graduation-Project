import * as vscode from 'vscode';

/**
 * [TASK_11 §3.5] 서버 REST 클라이언트.
 *
 * 모든 REST 응답은 {status, code?, message?, data?} 봉투다(§3.2). 여기서 봉투를 벗겨 `data` 만
 * 돌려주고, 실패는 전부 ApiError 로 통일한다 — 호출부가 Pxxxx 코드로 분기할 수 있게 하기 위해서다.
 *
 * HTTP 라이브러리는 따로 쓰지 않는다. 확장 호스트는 Node 18+ 라 전역 fetch 가 있고,
 * 의존성을 늘리면 번들·설치·보안 관리 대상만 늘어난다.
 */

/** 서버 공통 응답 봉투(§3.2). */
export type ApiEnvelope<T> = {
    status: 'success' | 'error';
    code?: string | number;
    message?: string;
    data?: T;
};

/** 서버가 돌려준 `Pxxxx` 코드를 보존한다(§12.12). 호출부가 코드로 분기한다. */
export class ApiError extends Error {
    /** 서버 오류 코드(P0001…P0902). 네트워크 오류처럼 코드가 없는 실패는 undefined 다. */
    readonly code?: string | number;
    /** HTTP 상태 코드. 응답을 받지 못한 실패는 undefined 다. */
    readonly status?: number;
    /**
     * 오류와 함께 온 `data`. 서버가 실패 사유를 구조로 돌려주는 경우가 있다 —
     * P0809 는 브랜치 접속자 목록, P0810 은 커밋되지 않은 변경 목록(§3.2, §15.4).
     */
    readonly data?: unknown;

    constructor(message: string, options: { code?: string | number; status?: number; data?: unknown } = {}) {
        super(message);
        this.name = 'ApiError';
        this.code = options.code;
        this.status = options.status;
        this.data = options.data;
    }
}

/**
 * 토큰 공급자. api.ts 가 repoSession 을 직접 import 하면 순환 참조가 되므로(세션은 api 로 교환하고,
 * api 는 세션의 토큰을 쓴다) 세션 모듈이 활성화 시점에 자기 함수를 꽂는다 — 요청 인터셉터 역할(§3.5).
 */
let accessTokenProvider: () => Promise<string | undefined> = async () => undefined;

export function setAccessTokenProvider(provider: () => Promise<string | undefined>): void {
    accessTokenProvider = provider;
}

const DEFAULT_SERVER_URL = 'https://axisflow.team/api';

/** 설정 `axis-share.serverUrl`(§15.13). 끝의 '/' 는 잘라 경로를 붙이기 쉽게 만든다. */
export function getServerBaseUrl(): string {
    const configured = vscode.workspace.getConfiguration('axis-share').get<string>('serverUrl', '');
    const base = configured.trim().length > 0 ? configured.trim() : DEFAULT_SERVER_URL;
    return base.replace(/\/+$/, '');
}

export type ApiRequestOptions = {
    method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    body?: unknown;
    /** false 면 Authorization 을 붙이지 않는다 — 토큰을 받기 전(세션 교환·갱신)에 쓴다(§3.4). */
    includeToken?: boolean;
    timeoutMs?: number;
    signal?: AbortSignal;
};

const DEFAULT_TIMEOUT_MS = 15_000;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 실패 본문에서 code/message/data 를 뽑는다. JSON 이 아니면(프록시 502 등) null. */
function readFailure(payload: unknown): { code?: string | number; message?: string; data?: unknown } | null {
    if (!isRecord(payload)) {
        return null;
    }

    const code = payload.code;
    const message = payload.message;
    return {
        code: typeof code === 'string' || typeof code === 'number' ? code : undefined,
        message: typeof message === 'string' ? message : undefined,
        data: payload.data
    };
}

/**
 * 서버 REST 호출(§3.5). 성공하면 `data` 를 돌려주고, 실패하면 ApiError 를 던진다.
 * HTTP 상태가 200 이어도 `status:"error"` 면 실패로 본다 — 서버가 그렇게 돌려주는 경로가 있다.
 */
export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    const url = `${getServerBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
    const headers: Record<string, string> = { Accept: 'application/json' };

    let body: string | undefined;
    if (options.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        body = JSON.stringify(options.body);
    }

    if (options.includeToken !== false) {
        const token = await accessTokenProvider();
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
    }

    // 호출부 취소와 타임아웃을 하나의 신호로 합친다(제어 소켓 재접속 중 이전 요청을 버릴 때 쓴다).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const abortByCaller = () => controller.abort();
    options.signal?.addEventListener('abort', abortByCaller);

    let response: Response;
    try {
        response = await fetch(url, { method: options.method ?? 'GET', headers, body, signal: controller.signal });
    } catch (error) {
        throw new ApiError(
            controller.signal.aborted
                ? '서버 응답이 없습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.'
                : `서버에 연결하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`
        );
    } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', abortByCaller);
    }

    // 본문이 비었거나 JSON 이 아니어도(예: 204, HTML 오류 페이지) 아래에서 상태 코드로 판정한다.
    let payload: unknown;
    try {
        payload = await response.json();
    } catch {
        payload = undefined;
    }

    const envelope = isRecord(payload) ? (payload as ApiEnvelope<T>) : undefined;
    if (!response.ok || envelope?.status === 'error') {
        const failure = readFailure(payload);
        throw new ApiError(failure?.message ?? `서버 요청이 실패했습니다 (HTTP ${response.status}).`, {
            code: failure?.code,
            status: response.status,
            data: failure?.data
        });
    }

    return envelope?.data as T;
}