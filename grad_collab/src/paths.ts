// 저장소 트리 안의 경로를 다룰 때 쓰는 최소 안전 장치 (TASK_11 §9.4).
//
// collab 은 클라이언트가 보낸 `path` 를 그대로 파일 경로에 붙인다. 여기서 한 번 걸러
// 상위 탈출(`..`)·절대 경로·역슬래시를 막지 않으면 worktree 밖의 파일을 읽고 쓸 수 있다.
import * as path from 'node:path';

/** 저장소 트리 기준 상대 경로로 쓸 수 있는지 검사한다. */
export function isSafeRelPath(rel: unknown): rel is string {
  if (typeof rel !== 'string') return false;
  if (rel.length === 0 || rel.length > 4096) return false;
  if (rel.includes('\0') || rel.includes('\\')) return false;
  if (rel.startsWith('/') || rel.startsWith('~')) return false;
  if (path.isAbsolute(rel)) return false;
  return rel.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

/** target 이 root 아래에 있는지 확인한다(정규화·심볼릭 링크 방어). */
export function assertInside(root: string, target: string): void {
  const rootAbs = path.resolve(root);
  const targetAbs = path.resolve(target);
  if (targetAbs !== rootAbs && !targetAbs.startsWith(rootAbs + path.sep)) {
    throw new Error(`경로가 저장소 루트를 벗어났습니다: ${target}`);
  }
}

/** 루트 아래의 절대 경로를 만든다. 검증에 실패하면 예외를 던진다. */
export function safeJoin(root: string, rel: string): string {
  if (!isSafeRelPath(rel)) {
    throw new Error(`안전하지 않은 상대 경로입니다: ${rel}`);
  }
  const target = path.resolve(root, ...rel.split('/'));
  assertInside(root, target);
  return target;
}