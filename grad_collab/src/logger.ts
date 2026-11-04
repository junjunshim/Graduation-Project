// JSON 한 줄 로그 (TASK_11 §9.9). 컨테이너 로그에서 {repo, branch, path, user} 로 추적한다.
export type LogLevel = 'info' | 'warn' | 'error';

/** 로그에 붙일 추적 컨텍스트. 값이 없는 키는 넣지 않는다. */
export interface LogContext {
  repo?: number;
  branch?: string;
  path?: string;
  user?: string;
  [key: string]: unknown;
}

export function log(level: LogLevel, message: string, context: LogContext = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg: message, ...context });
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}