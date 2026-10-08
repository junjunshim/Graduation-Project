// 문서 소켓 메시지 규격 (TASK_11 §9.5).
//
// 1차는 JSON 텍스트 프레임 + base64 로 통일한다(바이너리 최적화는 2차). 여기서는
// 프레이밍 크기 상한과 필수 필드만 검증하고, 의미 해석은 각 핸들러가 맡는다.

/** 클라이언트 → collab 프레임. */
export type ClientFrame =
  | { type: 'join'; repo_id: number; branch: string }
  | { type: 'open'; path: string }
  | { type: 'close'; path: string }
  | { type: 'update'; path: string; update: string }
  | { type: 'cursor'; path: string; startRel?: unknown; endRel?: unknown; activeRel?: unknown }
  | { type: 'deco_add'; path: string; id: string; anchor?: unknown; text?: string }
  | { type: 'deco_del'; path: string; id: string }
  | { type: 'flush'; path?: string }
  | { type: 'switch_branch'; repo_id: number; from: string; to: string };

/** 프레임 크기 상한. Yjs 델타는 작고, 큰 파일은 REST 로 다룬다(§13.4). */
export const MAX_FRAME_BYTES = 4 * 1024 * 1024;

/** 타입별 필수 필드. 값의 형식까지는 보지 않는다. */
const REQUIRED_FIELDS: Record<string, ReadonlyArray<string>> = {
  join: ['repo_id', 'branch'],
  open: ['path'],
  close: ['path'],
  update: ['path', 'update'],
  cursor: ['path'],
  deco_add: ['path', 'id'],
  deco_del: ['path', 'id'],
  flush: [],
  switch_branch: ['repo_id', 'from', 'to'],
};

export type FrameParseResult =
  | { ok: true; frame: ClientFrame }
  | { ok: false; code: string; message: string };

/**
 * 원시 프레임을 검증해 타입이 있는 프레임으로 바꾼다.
 * 실패해도 예외를 던지지 않는다 — 소켓 핸들러가 `err` 프레임으로 돌려준다.
 */
export function parseClientFrame(raw: string): FrameParseResult {
  if (Buffer.byteLength(raw, 'utf8') > MAX_FRAME_BYTES) {
    return { ok: false, code: 'P0905', message: '프레임이 너무 큽니다.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, code: '400', message: 'JSON 프레임이 아닙니다.' };
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, code: '400', message: 'JSON 객체가 아닙니다.' };
  }

  const record = parsed as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== 'string' || !(type in REQUIRED_FIELDS)) {
    return { ok: false, code: '400', message: `알 수 없는 메시지 타입입니다: ${String(type)}` };
  }

  for (const field of REQUIRED_FIELDS[type]) {
    const value = record[field];
    const valid =
      field === 'repo_id'
        ? typeof value === 'number' && Number.isInteger(value)
        : typeof value === 'string' && value.length > 0;
    if (!valid) {
      return { ok: false, code: '400', message: `필수 필드가 올바르지 않습니다: ${field}` };
    }
  }

  return { ok: true, frame: record as unknown as ClientFrame };
}