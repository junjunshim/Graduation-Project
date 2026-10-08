// 파일 하나 = Y.Doc 하나. 수명주기·참조 계수·로드/언로드를 담당한다 (TASK_11 §9.3 / §14.2).
//
//  - 최초 open: `.ydoc` 가 있으면 그것으로 복원하고, 없으면 worktree 파일에서 만든다.
//    (파일에서 새로 만들면 §8.10 의 이유로 텍스트가 중복된다 — 그래서 `.ydoc` 가 우선이다)
//  - 마지막 watcher 가 나가면 grace(기본 30초) 뒤 flush → 영속화 → 메모리 해제.
//  - 편집 후 디바운스(기본 2초)와 주기(기본 30초)로 파일에 내려쓴다(§9.4).
//  - 파일 쓰기는 경로별 큐로 직렬화한다(§9.6). Yjs 병합은 이벤트 루프가 직렬화한다.
import * as Y from 'yjs';

import { config } from './config';
import { log } from './logger';
import {
  Eol,
  FileNotEditableError,
  flushFile,
  readDocState,
  readFileText,
  tryReadFileText,
  writeDocState,
} from './store';

/** Yjs 공유 텍스트 타입 이름. 레퍼런스(p2p-code-share)와 동일하게 맞춘다(§8.5). */
export const TEXT_TYPE = 'codetext';

/** 리뷰 데코레이션 저장용 Y.Map. 값은 JSON 문자열이다(§9.5 — 서버는 해석하지 않는다). */
export const DECO_MAP = 'axis:deco';

/** doc 을 보고 있는 소켓. */
export interface Watcher {
  clientId: string;
  userEmail: string;
  userName: string;
}

export interface DocEntry {
  filePath: string;
  doc: Y.Doc;
  eol: Eol;
  bom: boolean;
  watchers: Map<string, Watcher>;
  dirty: boolean;
  /** 복원한 doc 과 worktree 파일이 어긋난 채 열렸다(§9.3 — 자동 병합하지 않는다). */
  mismatch: boolean;
  lastFlushAt: number | null;
  flushTimer: NodeJS.Timeout | undefined;
  unloadTimer: NodeJS.Timeout | undefined;
  /** 최초 로드(파일 또는 `.ydoc`) 완료를 기다리는 promise. 동시 open 의 유일한 방어선이다. */
  loading: Promise<void>;
  /** 경로별 쓰기 직렬화 큐. 절대 reject 하지 않는다(그래야 다음 flush 가 막히지 않는다). */
  chain: Promise<void>;
}

export interface AcquireResult {
  entry: DocEntry;
  /** 클라이언트의 Yjs replica 를 만드는 초기 상태(base64). */
  state: string;
  created: boolean;
}

/** Y.Doc 전체 상태를 base64 로. `opened` 프레임에 그대로 싣는다. */
export function encodeState(doc: Y.Doc): string {
  return Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
}

export class DocRegistry {
  private readonly docs = new Map<string, DocEntry>();
  private lastFlush: number | null = null;
  private readonly autosave: NodeJS.Timeout;

  constructor(
    private readonly worktreeDir: string,
    private readonly collabDir: string,
  ) {
    this.autosave = setInterval(() => {
      void this.flushDirty();
    }, config.autosaveIntervalMs);
    this.autosave.unref();
  }

  get openCount(): number {
    return this.docs.size;
  }

  get dirtyCount(): number {
    let total = 0;
    for (const entry of this.docs.values()) if (entry.dirty) total += 1;
    return total;
  }

  lastFlushAt(): number | null {
    return this.lastFlush;
  }

  paths(): string[] {
    return [...this.docs.keys()];
  }

  has(filePath: string): boolean {
    return this.docs.has(filePath);
  }

  entry(filePath: string): DocEntry | undefined {
    return this.docs.get(filePath);
  }

  watchersOf(filePath: string): Watcher[] {
    const entry = this.docs.get(filePath);
    return entry ? [...entry.watchers.values()] : [];
  }

  /** 이 소켓이 보고 있는 파일들(방을 떠날 때 정리용). */
  pathsWatchedBy(clientId: string): string[] {
    const paths: string[] = [];
    for (const entry of this.docs.values()) {
      if (entry.watchers.has(clientId)) paths.push(entry.filePath);
    }
    return paths;
  }

  /**
   * doc 을 연다. 없으면 만든다 — 동시에 두 명이 처음 열어도 doc 은 하나다.
   *
   * 순서가 중요하다. 엔트리를 맵에 먼저 등록하고(로드 전에) `loading` 을 걸어 두면,
   * 뒤따라온 open 은 같은 엔트리를 받아 그 promise 를 기다린다. 이렇게 하지 않으면
   * 두 번째 사람이 "아직 비어 있는 doc" 의 상태를 받아 간다.
   */
  async acquire(filePath: string, watcher: Watcher): Promise<AcquireResult> {
    const existing = this.docs.get(filePath);
    if (existing) {
      await existing.loading;
      existing.watchers.set(watcher.clientId, watcher);
      this.clearUnload(existing);
      return { entry: existing, state: encodeState(existing.doc), created: false };
    }

    const entry = this.createEntry(filePath);
    const loading = this.load(entry);
    entry.loading = loading;
    this.docs.set(filePath, entry);

    try {
      await loading;
    } catch (error) {
      // 열지 못했으면 흔적을 남기지 않는다 — 다음 open 이 다시 시도할 수 있어야 한다.
      this.docs.delete(filePath);
      throw error;
    }

    entry.watchers.set(watcher.clientId, watcher);
    return { entry, state: encodeState(entry.doc), created: true };
  }

  /** doc 에서 나간다. 마지막 사람이면 grace 뒤에 정리한다. */
  release(filePath: string, clientId: string): void {
    const entry = this.docs.get(filePath);
    if (!entry) return;
    entry.watchers.delete(clientId);
    if (entry.watchers.size === 0) {
      this.scheduleUnload(entry);
    }
  }

  /** 편집이 있었다고 알린다(디바운스 flush 예약). */
  touch(filePath: string): void {
    const entry = this.docs.get(filePath);
    if (!entry) return;
    entry.dirty = true;
    if (entry.flushTimer) clearTimeout(entry.flushTimer);
    entry.flushTimer = setTimeout(() => {
      entry.flushTimer = undefined;
      void this.flush(filePath).catch(() => undefined);
    }, config.flushDebounceMs);
    entry.flushTimer.unref();
  }

  /** 파일에 내려쓰고 `.ydoc` 를 갱신한다. 실패하면 reject 한다(호출자가 P0906 으로 돌려준다). */
  flush(filePath: string): Promise<void> {
    const entry = this.docs.get(filePath);
    if (!entry) return Promise.resolve();
    return this.enqueue(entry, () => this.writeEntry(entry));
  }

  /** 열린 doc 을 전부 내려쓴다. 실패는 로그만 남긴다(브랜치 전환·종료 경로). */
  async flushAll(): Promise<void> {
    await Promise.all(
      this.paths().map((filePath) =>
        this.flush(filePath).catch((error: unknown) => {
          log('error', 'flush 실패', { path: filePath, reason: (error as Error).message });
        }),
      ),
    );
  }

  /** 주기 저장. 더러운 doc 만 내려쓴다. */
  async flushDirty(): Promise<void> {
    for (const entry of [...this.docs.values()]) {
      if (!entry.dirty) continue;
      await this.flush(entry.filePath).catch((error: unknown) => {
        log('error', 'flush 실패', { path: entry.filePath, reason: (error as Error).message });
      });
    }
  }

  /** 마지막 정리 — 타이머를 끊고 전부 내려쓴 뒤 메모리에서 놓는다. */
  async dispose(): Promise<void> {
    clearInterval(this.autosave);
    for (const entry of this.docs.values()) {
      if (entry.flushTimer) clearTimeout(entry.flushTimer);
      if (entry.unloadTimer) clearTimeout(entry.unloadTimer);
      entry.flushTimer = undefined;
      entry.unloadTimer = undefined;
    }
    await this.flushAll();
    this.docs.clear();
  }

  // --- 리뷰 데코레이션 (§9.5: 파일의 Y.Doc 안에 저장, 서버는 내용을 해석하지 않는다) -------

  /** 데코레이션을 저장한다. `payload` 는 클라이언트가 보낸 JSON 그대로다. */
  setDecoration(filePath: string, id: string, payload: Record<string, unknown>): void {
    const entry = this.docs.get(filePath);
    if (!entry) return;
    entry.doc.getMap(DECO_MAP).set(id, JSON.stringify(payload));
    this.touch(filePath);
  }

  deleteDecoration(filePath: string, id: string): void {
    const entry = this.docs.get(filePath);
    if (!entry) return;
    const map = entry.doc.getMap(DECO_MAP);
    if (!map.has(id)) return;
    map.delete(id);
    this.touch(filePath);
  }


  // --- 내부 -------------------------------------------------------------------------------

  private createEntry(filePath: string): DocEntry {
    const doc = new Y.Doc();
    doc.getText(TEXT_TYPE);
    return {
      filePath,
      doc,
      eol: 'lf',
      bom: false,
      watchers: new Map(),
      dirty: false,
      mismatch: false,
      lastFlushAt: null,
      flushTimer: undefined,
      unloadTimer: undefined,
      loading: Promise.resolve(),
      chain: Promise.resolve(),
    };
  }

  private async load(entry: DocEntry): Promise<void> {
    const persisted = await readDocState(this.collabDir, entry.filePath);

    if (persisted && persisted.byteLength > 0) {
      // 복원이 우선이다. 파일에서 새로 만들면 클라이언트가 들고 있던 doc 과 병합되며 중복된다.
      Y.applyUpdate(entry.doc, persisted, 'persist');
      const onDisk = await tryReadFileText(this.worktreeDir, entry.filePath);
      if (onDisk) {
        entry.eol = onDisk.eol;
        entry.bom = onDisk.bom;
        entry.mismatch = onDisk.text !== entry.doc.getText(TEXT_TYPE).toString();
      }
      if (entry.mismatch) {
        // 자동 병합하지 않는다(§9.3). doc 을 그대로 서비스하고 차이만 남긴다.
        log('warn', 'doc 상태와 worktree 파일이 다릅니다 (doc 우선)', {
          path: entry.filePath,
          mismatch: true,
        });
      }
      return;
    }

    const file = await readFileText(this.worktreeDir, entry.filePath);
    entry.eol = file.eol;
    entry.bom = file.bom;
    if (file.text.length > 0) {
      entry.doc.getText(TEXT_TYPE).insert(0, file.text);
    }
  }

  private clearUnload(entry: DocEntry): void {
    if (!entry.unloadTimer) return;
    clearTimeout(entry.unloadTimer);
    entry.unloadTimer = undefined;
  }

  private scheduleUnload(entry: DocEntry): void {
    this.clearUnload(entry);
    entry.unloadTimer = setTimeout(() => {
      entry.unloadTimer = undefined;
      void this.unload(entry);
    }, config.docIdleUnloadMs);
    entry.unloadTimer.unref();
  }

  /**
   * grace 가 지났다. 그 사이 다시 들어왔으면 아무것도 하지 않는다.
   *
   * 마지막 flush 가 끝난 **뒤에** 맵에서 내린다. 먼저 내리면 그 사이에 들어온 open 이
   * 아직 갱신되지 않은 `.ydoc` 을 읽어 마지막 편집을 놓칠 수 있다.
   */
  private async unload(entry: DocEntry): Promise<void> {
    if (entry.watchers.size > 0) return;
    if (entry.flushTimer) {
      clearTimeout(entry.flushTimer);
      entry.flushTimer = undefined;
    }

    try {
      await this.enqueue(entry, () => this.writeEntry(entry));
    } catch (error) {
      log('error', 'flush 실패(내리는 중)', { path: entry.filePath, reason: (error as Error).message });
    }

    if (entry.watchers.size > 0) return; // 내려쓰는 동안 다시 들어왔다

    // 맵에서 빼면 더 이상 아무도 이 doc 을 찾지 않는다. `Y.Doc.destroy()` 는 부르지 않는다 —
    // 아직 큐에 남은 쓰기(예: 종료 중 flushAll)가 파괴된 doc 을 건드리면 예외가 나기 때문이다.
    this.docs.delete(entry.filePath);
    log('info', 'doc 내려감', { path: entry.filePath });
  }

  /** 경로별 쓰기 큐. 이전 작업이 실패했어도 다음 작업은 진행한다. */
  private enqueue(entry: DocEntry, work: () => Promise<void>): Promise<void> {
    const next = entry.chain.then(work, work);
    entry.chain = next.catch(() => undefined);
    return next;
  }

  private async writeEntry(entry: DocEntry): Promise<void> {
    const text = entry.doc.getText(TEXT_TYPE).toString();
    try {
      await flushFile(this.worktreeDir, entry.filePath, text, entry.eol, entry.bom);
      await writeDocState(this.collabDir, entry.filePath, Y.encodeStateAsUpdate(entry.doc));
    } catch (error) {
      log('error', 'flush 실패', { path: entry.filePath, reason: (error as Error).message });
      throw error;
    }
    entry.dirty = false;
    entry.mismatch = false;
    entry.lastFlushAt = Date.now();
    this.lastFlush = entry.lastFlushAt;
  }
}

