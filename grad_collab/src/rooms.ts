// 브랜치 방 레지스트리 (TASK_11 §2.3 / §9.5 / §14.2).
//
// 방 하나 = (저장소, 브랜치) 하나 = worktree 하나. 다른 브랜치 사용자끼리는 같은 방에
// 들어오지 않으므로 실시간 편집이 브랜치를 넘어 새지 않는다. 방이 비면 그 안의 doc 을
// 전부 파일로 내려쓰고 메모리에서 놓는다.
import { CollabSession } from './auth';
import { DocRegistry } from './docRegistry';
import { log } from './logger';
import { notifyWorktreeChanged } from './notify';
import { PresenceRegistry } from './presence';
import { ResolvedRepo } from './repoResolver';

/** 문서 소켓 하나. 방이 이 객체를 통해 프레임을 보낸다. */
export interface RoomClient {
  readonly id: string;
  readonly session: CollabSession;
  /** 지금 들어가 있는 방. 한 소켓은 한 번에 한 방에만 속한다. */
  room: Room | null;
  /** 살아 있는 소켓이면 JSON 프레임을 보낸다. 끊긴 소켓은 조용히 무시한다. */
  send(frame: unknown): void;
}

export function roomKey(repoId: number, branch: string): string {
  return `repo:${repoId}:branch:${branch}`;
}

export class Room {
  readonly clients = new Set<RoomClient>();
  readonly docs: DocRegistry;
  readonly presence = new PresenceRegistry();

  constructor(readonly repo: ResolvedRepo) {
    this.docs = new DocRegistry(repo.worktreeDir, repo.collabDir);
    // 파일이 flush 될 때마다 backend 에 알려, 같은 브랜치 접속자(Changes 뷰)가 즉시 갱신되게 한다(§9.9).
    this.docs.setFlushListener((filePath) => notifyWorktreeChanged(repo.repoId, repo.branch, filePath));
  }

  get key(): string {
    return roomKey(this.repo.repoId, this.repo.branch);
  }

  /** 방 전체(브랜치 접속자)에게. */
  broadcast(frame: unknown, exceptClientId?: string): void {
    for (const client of this.clients) {
      if (client.id === exceptClientId) continue;
      client.send(frame);
    }
  }

  /** 그 파일을 열고 있는 사람에게만. */
  broadcastWatchers(filePath: string, frame: unknown, exceptClientId?: string): void {
    const ids = new Set(this.docs.watchersOf(filePath).map((watcher) => watcher.clientId));
    for (const client of this.clients) {
      if (client.id === exceptClientId || !ids.has(client.id)) continue;
      client.send(frame);
    }
  }
}

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();

  /** 방이 없으면 만든다. 경로 해석은 호출자가 이미 마쳤다. */
  ensure(repo: ResolvedRepo): Room {
    const key = roomKey(repo.repoId, repo.branch);
    const existing = this.rooms.get(key);
    if (existing) return existing;

    const room = new Room(repo);
    this.rooms.set(key, room);
    log('info', 'room opened', { repo: repo.repoId, branch: repo.branch });
    return room;
  }

  get(repoId: number, branch: string): Room | undefined {
    return this.rooms.get(roomKey(repoId, branch));
  }

  /** 마지막 편집자가 나간 방을 정리한다(flush → 영속화 → 메모리 해제). */
  async close(room: Room): Promise<void> {
    this.rooms.delete(room.key);
    room.presence.clear();
    await room.docs.dispose();
    log('info', 'room closed', { repo: room.repo.repoId, branch: room.repo.branch });
  }

  /** 서버 종료 — 모든 방을 내려쓴다. */
  async disposeAll(): Promise<void> {
    const rooms = [...this.rooms.values()];
    this.rooms.clear();
    for (const room of rooms) {
      room.presence.clear();
      await room.docs.dispose();
    }
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  get openDocs(): number {
    let total = 0;
    for (const room of this.rooms.values()) total += room.docs.openCount;
    return total;
  }

  lastFlushAt(): number | null {
    let latest: number | null = null;
    for (const room of this.rooms.values()) {
      const at = room.docs.lastFlushAt();
      if (at !== null && (latest === null || at > latest)) latest = at;
    }
    return latest;
  }
}