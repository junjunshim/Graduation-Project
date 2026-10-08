import { config } from './config';

/** 티켓 소비 결과로 확정되는 문서 소켓 세션 (TASK_11 §9.2 / §12.1). */
export interface CollabSession {
  userEmail: string;
  userName: string;
  /** 세션이 묶인 저장소. 방(`repo:{id}:branch:{name}`) 입장 시 이 값과 대조한다. */
  repoId: number;
  nodeId: number;
  /** C++ 가 판정한 쓰기 권한. false 면 클라이언트는 read-only 로 동작한다. */
  canWrite: boolean;
}

/** 티켓 검증 실패. code 는 P09xx(§12.12) 이고 그대로 클라이언트에 중계한다. */
export class CollabAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number = 401,
  ) {
    super(message);
    this.name = 'CollabAuthError';
  }
}

interface ConsumeResponse {
  status?: string;
  data?: unknown;
  code?: string;
  message?: string;
}

/**
 * 1회용 티켓을 세션으로 교환한다.
 *
 * collab 은 JWT 를 해석하지 않는다(§9.2). C++ 내부 API 한 곳에서만 사용자·저장소·권한을
 * 확정하고, 그 결과를 소켓 수명 동안 들고 있는다.
 */
export async function consumeTicket(ticket: string): Promise<CollabSession> {
  if (config.internalToken.length === 0) {
    // 서버 설정이 끝나지 않았으면 어떤 티켓도 받지 않는다(fail-closed).
    throw new CollabAuthError('P0903', '협업 서버 내부 토큰이 설정되지 않았습니다.', 503);
  }

  let response: Response;
  try {
    response = await fetch(`${config.apiBase}/internal/collab/tickets/consume`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': config.internalToken,
      },
      body: JSON.stringify({ ticket }),
    });
  } catch (error) {
    throw new CollabAuthError('P0903', `backend 에 연결할 수 없습니다: ${(error as Error).message}`, 503);
  }

  const body = (await response.json().catch(() => undefined)) as ConsumeResponse | undefined;
  const items = body && Array.isArray(body.data) ? (body.data as Array<Record<string, unknown>>) : undefined;

  if (!response.ok || body?.status !== 'success' || !items || items.length === 0) {
    const code = typeof body?.code === 'string' ? body.code : 'P0901';
    const message = typeof body?.message === 'string' ? body.message : '티켓을 확인할 수 없습니다.';
    throw new CollabAuthError(code, message, response.status === 503 ? 503 : 401);
  }

  const item = items[0];
  return {
    userEmail: String(item.user_email ?? ''),
    userName: String(item.user_name ?? ''),
    repoId: Number(item.repo_id ?? 0),
    nodeId: Number(item.node_id ?? 0),
    canWrite: item.can_write === true,
  };
}