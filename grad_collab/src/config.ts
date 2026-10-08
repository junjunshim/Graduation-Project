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
}

function readPort(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 && value < 65536 ? value : fallback;
}

export const config: CollabConfig = {
  port: readPort(process.env.PORT, 3000),
  apiBase: (process.env.API_BASE ?? 'http://backend:8080').replace(/\/+$/, ''),
  internalToken: process.env.INTERNAL_TOKEN ?? '',
  repoRoot: process.env.REPO_ROOT ?? '/app/repository',
};