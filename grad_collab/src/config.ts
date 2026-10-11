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
  /** 읽기 전용 열람(§12.6) 한 건에 실어 보내는 최대 바이트. 넘으면 내용 없이 크기만 알린다. */
  maxReadOnlyBytes: number;
  /**
   * 한 브랜치(방)에서 **동시에 열어 둘 수 있는** 파일 수 상한(§9.10).
   * doc 하나가 곧 메모리라, 한 방이 수백 개를 들고 있으면 EC2 한 대를 위험하게 만든다.
   */
  maxOpenDocsPerBranch: number;
  /**
   * 한 브랜치(방)가 들고 있을 수 있는 **열린 doc 총량**(문자 수 = UTF-16 코드 유닛) 상한(§9.10).
   * doc 메모리는 파일 수가 아니라 **바이트**에 비례하므로, 파일 수 상한만으로는 최악값을 막지 못한다
   * (200개 × 512KB = 텍스트 100MB → Yjs 실사용 200~400MB). 그래서 총량에도 뚜껑을 덮는다.
   * 안전 밸브라 정상 사용에서는 닿지 않는다 — 동시 25명이 각자 40KB 파일 10개를 열어도 1M 남짓이다.
   */
  maxOpenDocCharsPerBranch: number;
  /**
   * 소켓 하나에 쌓아 둘 수 있는 **송신 버퍼** 상한(바이트, §9.10).
   * 느린 수신자(멈춘 확장·끊긴 회선)에게 팬아웃하면 `ws` 가 그 소켓 버퍼에 프레임을 계속 쌓는다 —
   * 이 값은 그 상한이고, 넘으면 그 소켓만 끊는다(확장은 재접속 후 서버 상태로 다시 맞춘다, §12.10).
   */
  maxSocketBufferBytes: number;
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
  maxReadOnlyBytes: readPositiveInt(process.env.MAX_READONLY_BYTES, 4 * 1024 * 1024),
  maxOpenDocsPerBranch: readPositiveInt(process.env.MAX_OPEN_DOCS_PER_BRANCH, 200),
  maxOpenDocCharsPerBranch: readPositiveInt(process.env.MAX_OPEN_DOC_CHARS_PER_BRANCH, 10_000_000),
  maxSocketBufferBytes: readPositiveInt(process.env.MAX_SOCKET_BUFFER_BYTES, 16 * 1024 * 1024),
};