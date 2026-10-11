// 파일 입출력 + `.ydoc` 영속화 (TASK_11 §9.3 / §9.4 / §12.6).
//
// 이 모듈만 실제 디스크를 만진다. docRegistry 는 여기서 받은 텍스트/상태만 다룬다.
//   - 작업 트리 파일: 열 때 읽고, flush 할 때 원자적으로 되쓴다.
//   - `.ydoc`      : Y.Doc 상태(encodeStateAsUpdate)를 그대로 저장한다. 재시작 복구의 근거다.
import * as crypto from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import { config } from './config';
import { safeJoin, assertInside } from './paths';

/** Yjs 텍스트는 LF 로 고정한다. 원본 EOL 은 doc 생성 시 기억했다가 flush 때 되돌린다(§9.4). */
export type Eol = 'lf' | 'crlf';

/** worktree 파일을 텍스트로 읽은 결과. */
export interface FileText {
  /** LF 로 정규화되고 BOM 이 제거된 본문. */
  text: string;
  eol: Eol;
  bom: boolean;
}

/** 파일을 편집 가능한 텍스트로 열 수 없는 이유. 전부 `P0905` 로 나간다(§12.6). */
export type ReadFailureReason = 'missing' | 'not_file' | 'binary' | 'too_large' | 'not_utf8';

export class FileNotEditableError extends Error {
  constructor(
    readonly reason: ReadFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'FileNotEditableError';
  }
}

// 확장자로 바이너리를 먼저 걸러 낸다. 널 바이트 검사와 함께 쓴다(§12.6).
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.tiff', '.psd', '.svgz',
  '.pdf', '.zip', '.gz', '.tgz', '.bz2', '.xz', '.tar', '.7z', '.rar', '.jar', '.war',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.class', '.o', '.a', '.lib', '.wasm', '.node',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.mov', '.avi', '.mkv', '.wav', '.ogg', '.flac', '.webm',
  '.sqlite', '.sqlite3', '.db', '.mdb',
]);

const NUL_SCAN_BYTES = 8192;

function looksBinary(raw: Buffer, filePath: string): boolean {
  if (BINARY_EXTENSIONS.has(path.extname(filePath).toLowerCase())) return true;
  const limit = Math.min(raw.length, NUL_SCAN_BYTES);
  return raw.subarray(0, limit).includes(0);
}

/** UTF-8(BOM 허용)로 디코드한다. 실패하면 FileNotEditableError('not_utf8') 를 던진다. */
function decodeText(raw: Buffer, filePath: string): FileText {
  let start = 0;
  let bom = false;
  if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    bom = true;
    start = 3;
  }

  let body: string;
  try {
    body = new TextDecoder('utf-8', { fatal: true }).decode(raw.subarray(start));
  } catch {
    throw new FileNotEditableError('not_utf8', `UTF-8 로 읽을 수 없는 파일입니다: ${filePath}`);
  }

  return { text: body.replace(/\r\n/g, '\n'), eol: body.includes('\r\n') ? 'crlf' : 'lf', bom };
}

/** worktree 파일을 연다. 편집할 수 없으면 FileNotEditableError 를 던진다. */
export async function readFileText(worktreeDir: string, filePath: string): Promise<FileText> {
  const abs = safeJoin(worktreeDir, filePath);

  let stat;
  try {
    stat = await fsp.stat(abs);
  } catch {
    throw new FileNotEditableError('missing', `작업 디렉터리에 없는 파일입니다: ${filePath}`);
  }
  if (!stat.isFile()) {
    throw new FileNotEditableError('not_file', `파일이 아닙니다: ${filePath}`);
  }
  if (stat.size > config.maxDocBytes) {
    throw new FileNotEditableError('too_large', `파일이 커서 동시 편집을 지원하지 않습니다: ${filePath}`);
  }

  const raw = await fsp.readFile(abs);
  if (looksBinary(raw, filePath)) {
    throw new FileNotEditableError('binary', `바이너리 파일입니다: ${filePath}`);
  }
  return decodeText(raw, filePath);
}

/** 존재와 무관하게 텍스트를 시도한다. 편집 불가/없음이면 undefined (정합성 검사·복구용). */
export async function tryReadFileText(
  worktreeDir: string,
  filePath: string,
): Promise<FileText | undefined> {
  try {
    return await readFileText(worktreeDir, filePath);
  } catch (error) {
    if (error instanceof FileNotEditableError) return undefined;
    throw error;
  }
}

// --- 읽기 전용 열람 (§12.6) ----------------------------------------------------------------

/**
 * 읽기 전용 열람용으로 읽은 파일 1건. 편집(`FileText`)과 달리 크기 상한이 훨씬 크고,
 * 바이너리는 base64 로 돌려준다 — 에디터 텍스트로는 그릴 수 없기 때문이다.
 */
export type ViewFile =
  | { kind: 'text'; size: number; text: string }
  | { kind: 'binary'; size: number; base64: string }
  | { kind: 'too_large_view'; size: number };

/**
 * worktree 파일을 **읽기 전용 열람용**으로 읽는다(§12.6).
 *
 * 편집용 `readFileText` 와 다른 점 셋:
 *   1. 크기 상한이 `maxDocBytes`(512KB)가 아니라 `maxBytes`(기본 4MB)다 — 큰 파일도 보여 준다.
 *   2. UTF-8 이 아니어도 예외를 던지지 않는다. 손상 바이트를 대체 문자로 바꿔 보여 준다 —
 *      목적이 "편집할 수 있다"가 아니라 "볼 수 있다"이기 때문이다.
 *   3. 바이너리는 base64 로 돌려준다. 확장이 알맞은 방법(미리보기·저장)으로 처리한다.
 *
 * 상한을 넘는 파일은 내용 없이 크기만 알린다(`too_large_view`) — 소켓 한 프레임이 저장소보다
 * 커지면 안 된다.
 */
export async function readForView(
  worktreeDir: string,
  filePath: string,
  maxBytes: number,
): Promise<ViewFile> {
  const abs = safeJoin(worktreeDir, filePath);

  let stat;
  try {
    stat = await fsp.stat(abs);
  } catch {
    throw new FileNotEditableError('missing', `작업 디렉터리에 없는 파일입니다: ${filePath}`);
  }
  if (!stat.isFile()) {
    throw new FileNotEditableError('not_file', `파일이 아닙니다: ${filePath}`);
  }
  if (stat.size > maxBytes) {
    return { kind: 'too_large_view', size: stat.size };
  }

  const raw = await fsp.readFile(abs);
  if (looksBinary(raw, filePath)) {
    return { kind: 'binary', size: raw.length, base64: raw.toString('base64') };
  }

  // 손상 바이트는 대체 문자로 바꾼다(fatal: false). BOM 은 보이지 않게 떼어 낸다.
  const body = new TextDecoder('utf-8').decode(raw);
  return {
    kind: 'text',
    size: raw.length,
    text: body.charCodeAt(0) === 0xfeff ? body.slice(1) : body,
  };
}

// 같은 디렉터리에 임시 파일을 쓰고 rename 으로 교체한다. 부분 쓰기가 남지 않는다(§9.4).
async function writeAtomic(absPath: string, data: Buffer): Promise<void> {
  const dir = path.dirname(absPath);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(absPath)}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
  );
  try {
    await fsp.writeFile(tmp, data);
    await fsp.rename(tmp, absPath);
  } catch (error) {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/** Y.Doc 텍스트를 worktree 파일에 반영한다. 원본 EOL·BOM 을 복원한다. */
export async function flushFile(
  worktreeDir: string,
  filePath: string,
  text: string,
  eol: Eol,
  bom: boolean,
): Promise<void> {
  const abs = safeJoin(worktreeDir, filePath);
  assertInside(worktreeDir, abs);

  const body = eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text;
  const encoded = Buffer.from(body, 'utf8');
  const data = bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), encoded]) : encoded;
  await writeAtomic(abs, data);
}

// ---------------------------------------------------------------------------
// `.ydoc` 영속화 (§9.3 (가) 볼륨 파일)
// ---------------------------------------------------------------------------

/** `repository/<node>/<repo>.collab/<slug>/<sha1(path)>.ydoc` — 경로 자체를 파일명으로 쓸 수 없다. */
export function docStatePath(collabDir: string, filePath: string): string {
  const digest = crypto.createHash('sha1').update(filePath, 'utf8').digest('hex');
  return path.join(collabDir, `${digest}.ydoc`);
}

/** 영속화된 Y.Doc 상태. 없으면 undefined. */
export async function readDocState(collabDir: string, filePath: string): Promise<Uint8Array | undefined> {
  const abs = docStatePath(collabDir, filePath);
  try {
    return new Uint8Array(await fsp.readFile(abs));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Y.Doc 상태를 원자적으로 저장한다. */
export async function writeDocState(
  collabDir: string,
  filePath: string,
  update: Uint8Array,
): Promise<void> {
  await writeAtomic(docStatePath(collabDir, filePath), Buffer.from(update));
}

/** 브랜치·파일이 사라졌을 때 남은 `.ydoc` 을 지운다(§12.5). */
export async function removeDocState(collabDir: string, filePath: string): Promise<void> {
  await fsp.rm(docStatePath(collabDir, filePath), { force: true });
}

/**
 * 브랜치 디렉터리(`.ydoc` 전부 + `reviews.json`)를 통째로 지운다(브랜치 삭제, §9.7).
 *
 * 경로별로 지우지 않고 디렉터리를 지우는 이유: 메모리에 없는 doc 의 `.ydoc` 도 남아 있기 때문이다.
 * 남겨 두면 같은 이름의 브랜치를 다시 만들었을 때 열기(§9.3 — `.ydoc` 우선)가 옛 내용을 되살린다.
 */
export async function removeCollabDir(collabDir: string): Promise<void> {
  await fsp.rm(collabDir, { recursive: true, force: true });
}

/** 되돌리기로 지워야 하는 worktree 파일을 지운다(§12.11.1). 없어도 조용히 성공한다. */
export async function removeFile(worktreeDir: string, filePath: string): Promise<void> {
  await fsp.rm(safeJoin(worktreeDir, filePath), { force: true });
}