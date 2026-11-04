// 세션 권한 재확인 (TASK_11 §12.9).
//
// collab 은 자기 세션(사용자 × 저장소) 목록을 들고 주기적으로 backend 에 물어본다. 권한 변경
// 통보(`/internal/collab/permission`)가 유실된 경우의 안전망이다 — 제어 소켓이 끊긴(우회)
// 클라이언트, 통보 HTTP 의 일시 실패, 노드 삭제를 놓친 경우를 한 주기 안에 회수한다.
//
// 판정은 backend(DB 함수) 하나가 한다(§12.9) — collab 은 받은 값을 전달만 한다.
import { config } from './config';
import { log } from './logger';

/** 재확인할 세션 하나. 같은 저장소에 탭·창을 여러 개 열어도 (저장소, 사용자) 한 쌍이면 충분하다. */
export interface SessionRef {
  repoId: number;
  userEmail: string;
}

/** 재확인 결과. 권한 변경 통보의 `users` 항목과 같은 모양이다(canView/canWrite). */
export interface SessionPermission {
  repoId: number;
  userEmail: string;
  canView: boolean;
  canWrite: boolean;
}

/** 한 요청에 담는 세션 수. backend 상한(1000)보다 작게 잡아 여러 번 나눠 보낸다. */
const RECHECK_CHUNK = 500;

/** 한 요청의 응답 대기 상한(ms). 넘기면 그 묶음은 실패로 본다 — 다음 주기에 다시 물어본다. */
const RECHECK_TIMEOUT_MS = 10_000;

/**
 * backend 에 세션 권한을 물어본다.
 *
 * 한 묶음이 실패해도 나머지 묶음의 결과는 그대로 돌려준다(세션마다 독립이다). 아무것도 못 받으면
 * 빈 배열이고, 호출자는 그때 아무것도 바꾸지 않는다 — 안전망이 세션을 잘못 건드리면 안 된다.
 * `INTERNAL_TOKEN` 이 없으면 물어보지 않는다(fail-closed — 그 상태에서는 티켓도 이미 거부된다).
 */
export async function verifySessionPermissions(sessions: SessionRef[]): Promise<SessionPermission[]> {
  if (sessions.length === 0 || config.internalToken.length === 0) return [];

  const permissions: SessionPermission[] = [];
  for (let offset = 0; offset < sessions.length; offset += RECHECK_CHUNK) {
    const chunk = sessions.slice(offset, offset + RECHECK_CHUNK);
    permissions.push(...(await verifyChunk(chunk)));
  }
  return permissions;
}

/** 묶음 하나를 물어본다. 실패는 로그만 남기고 빈 배열(호출자가 세션을 건드리지 않게). */
async function verifyChunk(chunk: SessionRef[]): Promise<SessionPermission[]> {
  let response: Response;
  try {
    response = await fetch(`${config.apiBase}/internal/collab/permissions/recheck`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': config.internalToken,
      },
      body: JSON.stringify({
        sessions: chunk.map((session) => ({ repo_id: session.repoId, user_email: session.userEmail })),
      }),
      signal: AbortSignal.timeout(RECHECK_TIMEOUT_MS),
    });
  } catch (error) {
    log('warn', '권한 재확인 실패(연결)', { sessions: chunk.length, reason: (error as Error).message });
    return [];
  }

  const body = (await response.json().catch(() => undefined)) as
    | { status?: string; data?: unknown }
    | undefined;
  const items = body && Array.isArray(body.data) ? (body.data as Array<Record<string, unknown>>) : undefined;
  if (!response.ok || body?.status !== 'success' || !items) {
    log('warn', '권한 재확인 실패(응답)', { sessions: chunk.length, status: response.status });
    return [];
  }

  const permissions: SessionPermission[] = [];
  for (const item of items) {
    const repoId = Number(item.repo_id ?? Number.NaN);
    const userEmail = typeof item.user_email === 'string' ? item.user_email : '';
    if (!Number.isInteger(repoId) || userEmail.length === 0) continue;
    permissions.push({
      repoId,
      userEmail,
      // 값을 안 보내 온 항목으로 남의 세션을 끊지 않는다 — 없으면 "그대로" 로 본다(통보와 같은 규칙).
      canView: item.can_view !== false,
      canWrite: item.can_write === true,
    });
  }
  return permissions;
}
