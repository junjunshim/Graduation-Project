// 브랜치 작업 디렉터리 해석 (TASK_11 §9.4 / §13.3.1).
//
// collab 은 git 도 DB 도 모른다. 경로의 진실은 backend(DB + git worktree)에 있고, collab 은
// backend 내부 API 한 곳에서 "볼륨 루트 기준 상대 경로"를 받아 REPO_ROOT 에 붙여 쓴다.
//   작업 트리  : <REPO_ROOT>/<node_id>/<repo_name>[.worktrees/<slug>]
//   영속화     : <REPO_ROOT>/<node_id>/<repo_name>.collab/<slug>/
import { config } from './config';
import { log } from './logger';
import { safeJoin } from './paths';

/** 해석된 저장소·브랜치. 방(Room) 하나가 이 값을 하나 갖는다. */
export interface ResolvedRepo {
  repoId: number;
  nodeId: number;
  branch: string;
  defaultBranch: string;
  isDefault: boolean;
  /** 작업 트리 절대 경로(worktree 또는 기본 브랜치 clone 디렉터리). */
  worktreeDir: string;
  /** `.ydoc` 영속화 디렉터리 절대 경로. */
  collabDir: string;
}

/** 해석 실패. code 는 P09xx/P08xx 이고 그대로 클라이언트 `err` 프레임에 실린다. */
export class CollabResolveError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number = 502,
  ) {
    super(message);
    this.name = 'CollabResolveError';
  }
}

interface ResolveResponse {
  status?: string;
  data?: unknown;
  code?: string;
  message?: string;
}

// 경로는 브랜치 수명 동안 바뀌지 않는다. join 마다 backend 를 부르지 않도록 짧게 캐시한다.
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  value: ResolvedRepo;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(repoId: number, branch: string): string {
  return `${repoId}\u0000${branch}`;
}

function pickString(item: Record<string, unknown>, key: string): string {
  const value = item[key];
  return typeof value === 'string' ? value : '';
}

/** (저장소, 브랜치)의 작업 디렉터리를 해석한다. 캐시에 있으면 backend 를 부르지 않는다. */
export async function resolveRepo(repoId: number, branch: string): Promise<ResolvedRepo> {
  const key = cacheKey(repoId, branch);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.value;
  }

  if (config.internalToken.length === 0) {
    throw new CollabResolveError('P0903', '협업 서버 내부 토큰이 설정되지 않았습니다.', 503);
  }

  let response: Response;
  try {
    response = await fetch(`${config.apiBase}/internal/collab/resolve`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': config.internalToken,
      },
      body: JSON.stringify({ repo_id: repoId, branch }),
    });
  } catch (error) {
    throw new CollabResolveError(
      'P0903',
      `backend 에 연결할 수 없습니다: ${(error as Error).message}`,
      503,
    );
  }

  const body = (await response.json().catch(() => undefined)) as ResolveResponse | undefined;
  const items = body && Array.isArray(body.data) ? (body.data as Array<Record<string, unknown>>) : undefined;

  if (!response.ok || body?.status !== 'success' || !items || items.length === 0) {
    const code = typeof body?.code === 'string' ? body.code : 'P0801';
    const message = typeof body?.message === 'string' ? body.message : '작업 디렉터리를 확인할 수 없습니다.';
    throw new CollabResolveError(code, message, response.status === 503 ? 503 : 404);
  }

  const item = items[0];
  const worktreeRel = pickString(item, 'worktree_rel');
  const collabRel = pickString(item, 'collab_rel');

  let worktreeDir: string;
  let collabDir: string;
  try {
    // backend 가 준 상대 경로를 볼륨 루트에 붙인다. 상위 탈출·절대 경로는 여기서 거절된다.
    worktreeDir = safeJoin(config.repoRoot, worktreeRel);
    collabDir = safeJoin(config.repoRoot, collabRel);
  } catch (error) {
    throw new CollabResolveError('P0807', `저장소 경로가 올바르지 않습니다: ${(error as Error).message}`, 502);
  }

  const value: ResolvedRepo = {
    repoId: typeof item.repo_id === 'number' ? item.repo_id : repoId,
    nodeId: typeof item.node_id === 'number' ? item.node_id : 0,
    branch: pickString(item, 'branch') || branch,
    defaultBranch: pickString(item, 'default_branch'),
    isDefault: item.is_default === true,
    worktreeDir,
    collabDir,
  };

  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
  log('info', 'branch resolved', {
    repo: value.repoId,
    branch: value.branch,
    worktree: value.worktreeDir,
  });
  return value;
}

/** 브랜치가 삭제되는 등 경로가 바뀌었을 때 캐시를 비운다. */
export function forgetResolved(repoId: number, branch: string): void {
  cache.delete(cacheKey(repoId, branch));
}

/** 테스트·진단용. */
export function resolvedCacheSize(): number {
  return cache.size;
}