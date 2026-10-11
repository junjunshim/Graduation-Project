// 브랜치 단위 리뷰 인덱스 (TASK_11 §15.6).
//
// 리뷰 데코레이션의 진실은 각 파일 `Y.Doc` 의 DECO_MAP 이다(§9.5). 그런데 사이드바(Reviews 뷰)는
// **파일을 열지 않고도** 목록을 보여야 한다. 그 목록을 만들려고 브랜치의 `.ydoc` 를 매번 전부 열 수는
// 없다 — `.ydoc` 파일명이 sha1(path) 라서 경로 자체가 남아 있지도 않고, 비용도 크다.
// 그래서 여기에 **파생 인덱스**를 하나 더 둔다.
//
//   - `.ydoc` 에서 언제든 다시 만들 수 있는 파생물이다. 어긋나면 `.ydoc` 이 이긴다(§15.6).
//   - 저장 위치는 `<collabDir>/reviews.json` 이다. `.ydoc` 는 sha1 파일명이라 겹치지 않는다.
//   - `line` 은 **표시용 스냅샷**이다. 실제 이동은 열린 doc 에서 상대 좌표로 다시 계산한다(§8.10).
//   - 쓰기는 디바운스하고, 방이 비면 flush 한다(§9.3 의 `.ydoc` 수명주기와 같은 규칙).
import * as crypto from 'node:crypto';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';

import { log } from './logger';

/** 데코레이션 1건. 클라이언트가 받는 `deco` 프레임과 같은 모양을 유지한다(§9.5). */
export interface ReviewRecord {
  path: string;
  id: string;
  /** 데코레이션 종류(Typo/Grammar/Logical/Other/Highlight). 서버는 해석하지 않고 그대로 보관한다. */
  decoType?: string;
  memo?: string;
  /** 표시용 줄 번호 스냅샷(0-based). 상대 좌표에서 다시 계산할 수 있으면 그 값이 우선이다. */
  line?: number;
  startRel?: unknown;
  endRel?: unknown;
  userEmail: string;
  userName?: string;
  createdAt: string;
}

/** 저장 파일 이름. `.ydoc`(sha1) 와 겹치지 않는다. */
const FILE_NAME = 'reviews.json';

/** 파일 하나가 들고 있을 수 있는 데코레이션 수 상한(한 파일에 수천 개가 붙는 것은 사고다). */
const MAX_PER_FILE = 5000;

/** 편집이 몰릴 때 파일을 매번 다시 쓰지 않도록 묶는 시간(ms). */
const SAVE_DEBOUNCE_MS = 500;

interface FileShape {
  version: number;
  reviews: Record<string, Record<string, ReviewRecord>>;
}

export class ReviewIndex {
  /** path → (id → 레코드). 정렬은 snapshot 에서 한다. */
  private readonly byPath = new Map<string, Map<string, ReviewRecord>>();

  /** 최초 로드. 실패해도 reject 하지 않는다 — 빈 인덱스로 시작해 열리는 파일에서 채운다. */
  private readonly readyPromise: Promise<void>;

  private saveTimer: NodeJS.Timeout | undefined;

  /** 저장 직렬화 큐. 임시 파일 이름 충돌과 순서 역전을 막는다. 절대 reject 하지 않는다. */
  private saveChain: Promise<void> = Promise.resolve();

  private dirty = false;
  private disposed = false;

  constructor(private readonly dir: string) {
    this.readyPromise = this.load();
  }

  /** 최초 로드 완료를 기다린다. 입장 직후 스냅샷을 보내기 전에 부른다. */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  /** 브랜치 전체 데코레이션. 경로 → 줄 → 생성시각 순으로 안정 정렬한다. */
  snapshot(): ReviewRecord[] {
    const records: ReviewRecord[] = [];
    for (const group of this.byPath.values()) {
      records.push(...group.values());
    }

    records.sort(compareRecords);
    return records;
  }

  count(): number {
    let total = 0;
    for (const group of this.byPath.values()) {
      total += group.size;
    }

    return total;
  }

  upsert(record: ReviewRecord): void {
    let group = this.byPath.get(record.path);
    if (!group) {
      group = new Map<string, ReviewRecord>();
      this.byPath.set(record.path, group);
    }

    if (group.size >= MAX_PER_FILE && !group.has(record.id)) {
      log('warn', '리뷰 인덱스 상한 초과 — 인덱스에는 넣지 않습니다', { path: record.path });
      return;
    }

    group.set(record.id, record);
    this.scheduleSave();
  }

  remove(filePath: string, id: string): void {
    const group = this.byPath.get(filePath);
    if (!group || !group.delete(id)) return;

    if (group.size === 0) {
      this.byPath.delete(filePath);
    }

    this.scheduleSave();
  }

  /** 그 파일의 리뷰를 통째로 지운다(파일 삭제·이름변경, §12.5). */
  removePath(filePath: string): void {
    if (!this.byPath.delete(filePath)) return;
    this.scheduleSave();
  }

  /** 남은 쓰기를 즉시 흘려보낸다(방 종료·서버 종료). 로드보다 먼저 불려도 안전하다. */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }

    await this.enqueueSave();
  }

  /** 더 이상 쓰기를 예약하지 않는다. 먼저 `flush()` 를 부르는 것이 정상 순서다. */
  dispose(): void {
    this.disposed = true;
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
  }

  // --- 내부 ---------------------------------------------------------------------------------

  private async load(): Promise<void> {
    let raw: string;
    try {
      raw = await fsp.readFile(path.join(this.dir, FILE_NAME), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        log('warn', '리뷰 인덱스를 읽지 못했습니다', { reason: (error as Error).message });
      }
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // 깨진 파일은 버린다. 열리는 파일의 DECO_MAP 에서 다시 채워진다(파생물이므로 손실이 없다).
      log('warn', '리뷰 인덱스 파일이 손상되었습니다 — 빈 인덱스로 시작합니다');
      return;
    }

    const shape = parsed as FileShape;
    const reviews = shape && typeof shape === 'object' ? shape.reviews : undefined;
    if (!reviews || typeof reviews !== 'object') {
      return;
    }

    for (const [filePath, group] of Object.entries(reviews)) {
      if (!group || typeof group !== 'object') continue;
      const bucket = new Map<string, ReviewRecord>();
      for (const [id, value] of Object.entries(group)) {
        const record = normalizeRecord(value, filePath, id);
        if (record) bucket.set(id, record);
      }

      if (bucket.size > 0) {
        this.byPath.set(filePath, bucket);
      }
    }

    log('info', '리뷰 인덱스 로드', { files: this.byPath.size, records: this.count() });
  }

  private scheduleSave(): void {
    if (this.disposed) return;

    this.dirty = true;
    if (this.saveTimer) return;

    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined;
      void this.enqueueSave();
    }, SAVE_DEBOUNCE_MS);
  }

  private enqueueSave(): Promise<void> {
    const run = async (): Promise<void> => {
      if (!this.dirty) return;

      const shape: FileShape = { version: 1, reviews: {} };
      for (const [filePath, group] of this.byPath) {
        const bucket: Record<string, ReviewRecord> = {};
        for (const [id, record] of group) {
          bucket[id] = record;
        }
        shape.reviews[filePath] = bucket;
      }

      const payload = JSON.stringify(shape);
      this.dirty = false;

      try {
        await writeAtomic(path.join(this.dir, FILE_NAME), payload);
      } catch (error) {
        this.dirty = true; // 다음 기회에 다시 시도한다.
        log('warn', '리뷰 인덱스를 저장하지 못했습니다', { reason: (error as Error).message });
      }
    };

    this.saveChain = this.saveChain.then(run, run);
    return this.saveChain;
  }
}

/** 파일에서 읽은 값을 레코드로 정규화한다. 형식이 어긋나면 버린다. */
function normalizeRecord(value: unknown, filePath: string, id: string): ReviewRecord | undefined {
  if (!value || typeof value !== 'object') return undefined;

  const item = value as Record<string, unknown>;
  const userEmail = typeof item.userEmail === 'string' ? item.userEmail : undefined;
  if (userEmail === undefined) return undefined;

  return {
    path: filePath,
    id,
    decoType: typeof item.decoType === 'string' ? item.decoType : undefined,
    memo: typeof item.memo === 'string' ? item.memo : undefined,
    line: typeof item.line === 'number' && Number.isFinite(item.line) ? item.line : undefined,
    startRel: item.startRel,
    endRel: item.endRel,
    userEmail,
    userName: typeof item.userName === 'string' ? item.userName : undefined,
    createdAt: typeof item.createdAt === 'string' ? item.createdAt : '',
  };
}

/** 경로 → 줄 → 생성시각 → id. 같은 내용이면 언제나 같은 순서가 나온다. */
function compareRecords(a: ReviewRecord, b: ReviewRecord): number {
  if (a.path !== b.path) return a.path < b.path ? -1 : 1;

  const aLine = typeof a.line === 'number' ? a.line : Number.MAX_SAFE_INTEGER;
  const bLine = typeof b.line === 'number' ? b.line : Number.MAX_SAFE_INTEGER;
  if (aLine !== bLine) return aLine - bLine;

  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** 같은 디렉터리에 임시 파일을 쓰고 rename 으로 교체한다(§9.4 와 같은 방식). */
async function writeAtomic(absPath: string, text: string): Promise<void> {
  const dir = path.dirname(absPath);
  await fsp.mkdir(dir, { recursive: true });

  const tmp = path.join(
    dir,
    `.${path.basename(absPath)}.tmp-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
  );

  try {
    await fsp.writeFile(tmp, text, 'utf8');
    await fsp.rename(tmp, absPath);
  } catch (error) {
    await fsp.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
}