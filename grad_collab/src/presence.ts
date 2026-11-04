// 커서 상태 집계 (TASK_11 §12.8 / §14.2).
//
// 커서는 **휘발성**이다 — 저장하지 않는다(§8.10). 다만 늦게 들어온 사람이 이미 편집 중인
// 사람의 커서를 바로 보려면 "지금 어디에 있는지"를 방 안에서만 들고 있어야 한다.
// 데코레이션은 여기서 다루지 않는다 — 파일의 Y.Doc 안(DECO_MAP)에 저장된다(§9.5).
export interface CursorState {
  userEmail: string;
  userName: string;
  startRel?: unknown;
  endRel?: unknown;
  activeRel?: unknown;
}

/**
 * 방 하나의 파일별 커서 상태. 키는 `path`, 그 아래를 `userEmail` 로 다시 나눈다.
 * 같은 사용자가 탭을 여러 개 열어도 커서는 하나로 보이면 충분하다.
 */
export class PresenceRegistry {
  private readonly byPath = new Map<string, Map<string, CursorState>>();

  /** 커서를 갱신한다. 실제 팬아웃은 방(Room)이 한다. */
  setCursor(path: string, state: CursorState): void {
    let users = this.byPath.get(path);
    if (!users) {
      users = new Map();
      this.byPath.set(path, users);
    }
    users.set(state.userEmail, state);
  }

  /** 그 파일을 보는 사람이 아무도 없으면 커서도 지운다. */
  removeCursor(path: string, userEmail: string): void {
    const users = this.byPath.get(path);
    if (!users) return;
    users.delete(userEmail);
    if (users.size === 0) this.byPath.delete(path);
  }

  /** 파일의 모든 커서(늦게 들어온 사람에게 한 번에 보내 준다). */
  listCursors(path: string): CursorState[] {
    const users = this.byPath.get(path);
    return users ? [...users.values()] : [];
  }

  /** 파일 단위 정리(파일 삭제·이름변경). */
  removePath(path: string): void {
    this.byPath.delete(path);
  }

  /** 브랜치 방 전체 정리. */
  clear(): void {
    this.byPath.clear();
  }

  get cursorCount(): number {
    let total = 0;
    for (const users of this.byPath.values()) total += users.size;
    return total;
  }
}