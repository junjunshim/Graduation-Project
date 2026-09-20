import type { OrganizationNodeRecord } from './types'

/** 살아있는(삭제되지 않은) 노드만 남긴다. 진입점/상세의 일반 화면에서 사용한다. */
export function excludeDeletedNodes(nodes: OrganizationNodeRecord[]): OrganizationNodeRecord[] {
  return nodes.filter((node) => !node.isDeleted)
}

/** 휴지통 화면에서 사용할 삭제된 노드만 추린다. */
export function selectTrashNodes(nodes: OrganizationNodeRecord[]): OrganizationNodeRecord[] {
  return nodes.filter((node) => Boolean(node.isDeleted))
}

/**
 * 루트(자신)를 포함한 하위 노드 ID 목록.
 * path(조상 경로)에 루트가 포함된 노드를 우선 사용하고, path 가 비어 있는 캐시를 위해
 * parentNodeId 연결도 함께 따라간다.
 */
export function collectNodeSubtreeIds(
  rootNodeId: number,
  nodes: OrganizationNodeRecord[],
): number[] {
  const collected = new Set<number>([rootNodeId])

  nodes.forEach((node) => {
    if (Array.isArray(node.path) && node.path.includes(rootNodeId)) {
      collected.add(node.id)
    }
  })

  let changed = true
  while (changed) {
    changed = false
    nodes.forEach((node) => {
      if (collected.has(node.id) || node.parentNodeId === undefined) {
        return
      }
      if (collected.has(node.parentNodeId)) {
        collected.add(node.id)
        changed = true
      }
    })
  }

  return Array.from(collected)
}

/**
 * 살아있는 워크스페이스가 하나도 없이 전부 삭제된 상태인지.
 * 이 경우 진입점은 휴지통 모드를 켠 상태로 고정된다.
 */
export function isAllNodesDeleted(nodes: OrganizationNodeRecord[]): boolean {
  return nodes.length > 0 && nodes.every((node) => Boolean(node.isDeleted))
}

/**
 * 자신 또는 상위 조상이 삭제된 경우, 그 삭제된 노드를 반환한다.
 * 삭제된 워크스페이스(또는 그 하위 워크스페이스) 상세 진입을 차단할 때 사용한다.
 */
export function findDeletedAncestorNode(
  nodeId: number | string | undefined,
  nodes: OrganizationNodeRecord[],
): OrganizationNodeRecord | null {
  const parsedId = typeof nodeId === 'number' ? nodeId : Number.parseInt(String(nodeId ?? ''), 10)
  if (!Number.isFinite(parsedId) || parsedId <= 0) {
    return null
  }

  const target = nodes.find((node) => node.id === parsedId)
  if (!target) {
    return null
  }
  if (target.isDeleted) {
    return target
  }

  const ancestors: OrganizationNodeRecord[] = []
  const path = Array.isArray(target.path) ? [...target.path].reverse() : []
  path.forEach((ancestorId) => {
    if (ancestorId === target.id) return
    const ancestor = nodes.find((node) => node.id === ancestorId)
    if (ancestor) ancestors.push(ancestor)
  })

  // path 캐시가 비어 있는 경우를 대비해 parentNodeId 연결도 확인한다.
  let parentId = target.parentNodeId
  const visited = new Set<number>([target.id])
  while (parentId !== undefined && !visited.has(parentId)) {
    visited.add(parentId)
    const parent = nodes.find((node) => node.id === parentId)
    if (!parent) break
    ancestors.push(parent)
    parentId = parent.parentNodeId
  }

  return ancestors.find((ancestor) => Boolean(ancestor.isDeleted)) ?? null
}

/**
 * 휴지통에서 바로 복구할 수 있는지. 서버도 상위 워크스페이스가 삭제 상태면 복구를 거부한다.
 */
export function isRestorableFromTrash(
  node: OrganizationNodeRecord,
  nodes: OrganizationNodeRecord[],
): boolean {
  if (!node.isDeleted) {
    return false
  }
  if (node.parentNodeId === undefined) {
    return true
  }
  const parent = nodes.find((candidate) => candidate.id === node.parentNodeId)
  return !parent || !parent.isDeleted
}
