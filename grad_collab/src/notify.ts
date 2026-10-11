// worktree 변경 알림 (TASK_11 §9.9 / §15.10).
//
// collab 이 worktree 파일을 실제로 내려쓴 순간, 그 사실을 backend 에 알린다. 그러면 backend 가
// 그 브랜치 방의 모든 접속자에게 worktree_changed 를 중계하고, 익스텐션의 Changes 뷰가 즉시
// 다시 그린다 — "다른 사용자가 고친 파일이 내 화면엔 안 보인다" 를 없애려는 것이다.
//
// 편집자 자신도 이 알림을 받는다. 자기 편집을 낙관적으로 뷰에 칠하지 않고 서버가 확정한
// 뒤(flush 완료) 반영하는 편이 진실(git status)과 어긋나지 않는다.
//
// 같은 뷰 갱신을 위해 짧은 시간에 여러 파일이 flush 되면 묶어 한 번만 보낸다(디바운스).
// 실패는 치명적이지 않다 — 알림이 유실되면 다음 flush 나 사용자의 새로 고침이 따라잡는다.
import { config } from './config';
import { log } from './logger';

interface PendingNotify {
  repoId: number;
  branch: string;
  paths: Set<string>;
  timer: NodeJS.Timeout;
}

/** (저장소, 브랜치)별로 아직 보내지 않은 경로를 모아 둔다. */
const pending = new Map<string, PendingNotify>();

function keyOf(repoId: number, branch: string): string {
  return `repo:${repoId}:branch:${branch}`;
}

/** flush 가 끝난 파일 하나를 알림 대기열에 넣는다(디바운스 뒤 backend 로 한 번에 보낸다). */
export function notifyWorktreeChanged(repoId: number, branch: string, filePath: string): void {
  const key = keyOf(repoId, branch);
  const existing = pending.get(key);
  if (existing) {
    existing.paths.add(filePath);
    return;
  }

  const entry: PendingNotify = {
    repoId,
    branch,
    paths: new Set([filePath]),
    timer: setTimeout(() => {
      pending.delete(key);
      void flushNotify(entry);
    }, config.notifyDebounceMs),
  };
  entry.timer.unref();
  pending.set(key, entry);
}

/** 모아 둔 경로를 backend 에 보낸다. 내부 토큰이 없으면(설정 미완) 조용히 건너뛴다. */
async function flushNotify(entry: PendingNotify): Promise<void> {
  if (config.internalToken.length === 0) {
    return;
  }

  const paths = [...entry.paths];
  try {
    const response = await fetch(`${config.apiBase}/internal/collab/worktree-changed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Token': config.internalToken,
      },
      body: JSON.stringify({ repo_id: entry.repoId, branch: entry.branch, paths }),
    });
    if (!response.ok) {
      log('warn', 'worktree 변경 알림 실패', {
        repo: entry.repoId,
        branch: entry.branch,
        status: response.status,
      });
    }
  } catch (error) {
    log('warn', 'worktree 변경 알림 실패', {
      repo: entry.repoId,
      branch: entry.branch,
      reason: (error as Error).message,
    });
  }
}