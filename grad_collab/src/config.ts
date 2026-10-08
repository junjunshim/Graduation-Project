// collab 설정 (TASK_11 §14.1 / §14.2). 값은 환경변수로만 받는다.
export interface CollabConfig {
  /** 리스닝 포트. nginx `/collab/` 가 이 포트로 프록시한다. */
  port: number;
  /** C++ backend 주소. compose 내부 네트워크의 서비스 이름을 쓴다. */
  apiBase: string;
  /** backend ↔ collab 내부 인증 토큰. 비어 있으면 티켓 소비를 전부 거부한다(fail-closed). */
  internalToken: string;
  /** 저장소 볼륨 마운트 지점. backend 와 같은 물리 볼륨을 다른 경로로 본다(§13.3). */
  repoRoot: string;
  /** 마지막 편집 후 파일에 내려쓰기까지의 디바운스(§9.4 ①). */
  flushDebounceMs: number;
  /** 편집자가 모두 나간 뒤 doc 을 영속화하고 메모리에서 내리는 유예 시간(§9.3). */
  docIdleUnloadMs: number;
  /** 열린 doc 을 주기적으로 파일에 내려쓰는 간격(§9.4 ④). */
  autosaveIntervalMs: number;
  /** worktree 변경을 backend 에 알릴 때 묶어 보내는 디바운스(§9.9). */
  notifyDebounceMs: number;
  /** 동시 편집을 허용하는 파일 크기 상한(§6-10, 512KB). */
  maxDocBytes: number;
}

function readPort(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 && value < 65536 ? value : fallback;
}

function readPositiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export const config: CollabConfig = {
  port: readPort(process.env.PORT, 3000),
  apiBase: (process.env.API_BASE ?? 'http://backend:8080').replace(/\/+$/, ''),
  internalToken: process.env.INTERNAL_TOKEN ?? '',
  repoRoot: process.env.REPO_ROOT ?? '/app/repository',
  flushDebounceMs: readPositiveInt(process.env.FLUSH_DEBOUNCE_MS, 2000),
  docIdleUnloadMs: readPositiveInt(process.env.DOC_IDLE_UNLOAD_MS, 30_000),
  autosaveIntervalMs: readPositiveInt(process.env.AUTOSAVE_INTERVAL_MS, 30_000),
  notifyDebounceMs: readPositiveInt(process.env.WORKTREE_NOTIFY_DEBOUNCE_MS, 400),
  maxDocBytes: readPositiveInt(process.env.MAX_DOC_BYTES, 512 * 1024),
};