import type { OrganizationNodeRecord } from './types.js'

export type MoveTreeNode = Pick<OrganizationNodeRecord, 'id' | 'name' | 'nodeType' | 'parentNodeId' | 'path' | 'isDeleted'>
export type MoveTreePosition = { node: MoveTreeNode; x: number; y: number; width: number; height: number }
/**
 * 진입점 계층도 카드와 같은 크기를 기준으로 배치한다.
 * 높이는 하위 카드를 가진 카드(글리프 + 이름 + 하위 배지)가 실제로 차지하는 최소 높이라서,
 * 연결선이 카드 아래가 아니라 카드에 닿은 자리에서 시작한다.
 */
export const MOVE_CARD_WIDTH = 123
export const MOVE_CARD_HEIGHT = 192
/** 루트 카드는 진입점의 가로형 루트 카드(21.55rem × 6.45rem)와 같은 크기를 쓴다. */
export const MOVE_ROOT_WIDTH = 366
export const MOVE_ROOT_HEIGHT = 110
/** 루트의 직계 자식 행은 진입점 계층도의 자식 행(dendroChildrenRow gap: 0.85rem)과 같은 간격을 쓴다. */
const ROOT_COLUMN_GAP = 0.85 * 17
/** 루트 카드와 직계 자식 카드 사이의 세로 간격: 진입점 dendroChildrenRow 의 padding-top(100px)과 같다. */
const ROOT_ROW_GAP = 100
/**
 * 자식이 모두 말단 워크스페이스(하위 없음)면 진입점 계층도는 그 자식들을 한 줄로 세로로 쌓는다.
 * 첫 자식까지의 간격은 dendroChildrenRowVertical 의 padding-top(4.2rem), 형제 사이는 gap(1.5rem)과 같다.
 */
const LEAF_ROW_GAP = 4.2 * 17
const LEAF_SIBLING_GAP = 1.5 * 17
/** 하위 배지가 없는 말단 카드의 높이(패딩 + 글리프 + 이름 + 직속 표시). 세로로 쌓을 때 쓴다. */
const MOVE_LEAF_CARD_HEIGHT = 164
const COLUMN_GAP = 32
const ROW_GAP = 72

/** Apply the server's hypothetical paths without mutating the cached directory. */
export function projectNodeMoveTree(
  nodes: MoveTreeNode[],
  moved: Array<{ node_id: number; name: string; path: number[]; new_path?: number[]; is_deleted: boolean }>,
  afterMove: boolean,
): MoveTreeNode[] {
  const result = new Map(nodes.map((node) => [node.id, { ...node, path: [...node.path] }]))
  for (const node of moved) {
    const path = afterMove && node.new_path ? node.new_path : node.path
    result.set(node.node_id, {
      ...result.get(node.node_id), id: node.node_id, name: node.name,
      nodeType: result.get(node.node_id)?.nodeType ?? 'TEAM',
      path: [...path], parentNodeId: path.length > 1 ? path[path.length - 2] : undefined,
      isDeleted: node.is_deleted,
    })
  }
  return [...result.values()]
}

/**
 * 처음에 접어 둘 노드를 고른다.
 * 탐색할 루트의 직계 하위만 펼치고, 이전할 워크스페이스는 현재 위치까지 내려가는 길과 그 직계 하위만 펼친다.
 */
export function defaultCollapsedNodeIds(nodes: MoveTreeNode[], rootId: number, movingNodeId: number) {
  const parentById = new Map<number, number>()
  const hasChildren = new Set<number>()
  for (const node of nodes) {
    if (node.parentNodeId === undefined) continue
    parentById.set(node.id, node.parentNodeId)
    hasChildren.add(node.parentNodeId)
  }
  const expandedIds = new Set<number>([rootId, movingNodeId])
  const visited = new Set<number>([movingNodeId])
  let current = parentById.get(movingNodeId)
  while (current !== undefined && !visited.has(current)) {
    visited.add(current)
    expandedIds.add(current)
    current = parentById.get(current)
  }
  const collapsedIds = new Set<number>()
  for (const node of nodes) if (hasChildren.has(node.id) && !expandedIds.has(node.id)) collapsedIds.add(node.id)
  return collapsedIds
}

/** 주어진 노드들의 모든 자손 id를 모은다. 펼침/접힘 애니메이션을 적용할 카드를 찾는 데 쓴다. */
export function collectDescendantNodeIds(nodes: MoveTreeNode[], rootIds: Iterable<number>) {
  const childIds = new Map<number, number[]>()
  for (const node of nodes) {
    if (node.parentNodeId === undefined) continue
    const siblings = childIds.get(node.parentNodeId) ?? []
    siblings.push(node.id)
    childIds.set(node.parentNodeId, siblings)
  }
  const collected = new Set<number>()
  for (const rootId of rootIds) {
    const stack = [...(childIds.get(rootId) ?? [])]
    while (stack.length) {
      const id = stack.pop() as number
      if (collected.has(id)) continue
      collected.add(id)
      stack.push(...(childIds.get(id) ?? []))
    }
  }
  return collected
}

/** Lay out a single root tree, retaining every descendant and sibling branch. */
export function layoutNodeMoveTree(nodes: MoveTreeNode[], rootId: number, collapsedIds: ReadonlySet<number> = new Set()) {
  const root = nodes.find((node) => node.id === rootId)
  const children = new Map<number, MoveTreeNode[]>()
  for (const node of nodes) {
    if (node.parentNodeId !== undefined) {
      const siblings = children.get(node.parentNodeId) ?? []
      siblings.push(node)
      children.set(node.parentNodeId, siblings)
    }
  }
  const widths = new Map<number, number>()
  const measured = new Set<number>()
  /** 자식이 모두 말단인지: 루트의 자식 행은 진입점 계층도와 같이 항상 가로로 놓는다. */
  function isLeafRow(node: MoveTreeNode) {
    const kids = children.get(node.id) ?? []
    return node.id !== rootId && kids.length > 0 && kids.every((child) => (children.get(child.id) ?? []).length === 0)
  }
  function measure(node: MoveTreeNode): number {
    if (measured.has(node.id)) return MOVE_CARD_WIDTH
    measured.add(node.id)
    const descendants = collapsedIds.has(node.id) ? [] : children.get(node.id) ?? []
    const gap = node.id === rootId ? ROOT_COLUMN_GAP : COLUMN_GAP
    // 한 줄로 쌓는 하위는 폭이 카드 하나만큼만 필요하다.
    const rowWidth = isLeafRow(node) ? MOVE_CARD_WIDTH
      : descendants.reduce((sum, child) => sum + measure(child), 0) + Math.max(0, descendants.length - 1) * gap
    const width = Math.max(node.id === rootId ? MOVE_ROOT_WIDTH : MOVE_CARD_WIDTH, rowWidth)
    widths.set(node.id, width)
    return width
  }
  const positions: MoveTreePosition[] = []
  const edges: Array<{ parentId: number; childId: number; path: string }> = []
  const placed = new Set<number>()
  function place(node: MoveTreeNode, left: number, top: number) {
    if (placed.has(node.id)) return
    placed.add(node.id)
    const width = widths.get(node.id) ?? MOVE_CARD_WIDTH
    const cardWidth = node.id === rootId ? MOVE_ROOT_WIDTH : MOVE_CARD_WIDTH
    const cardHeight = node.id === rootId ? MOVE_ROOT_HEIGHT
      : children.has(node.id) ? MOVE_CARD_HEIGHT : MOVE_LEAF_CARD_HEIGHT
    const x = left + (width - cardWidth) / 2
    const rowGap = node.id === rootId ? ROOT_ROW_GAP : ROW_GAP
    const columnGap = node.id === rootId ? ROOT_COLUMN_GAP : COLUMN_GAP
    positions.push({ node, x, y: top, width: cardWidth, height: cardHeight })
    if (collapsedIds.has(node.id)) return
    const kids = (children.get(node.id) ?? []).filter((child) => !placed.has(child.id))
    if (!kids.length) return
    const fromX = x + cardWidth / 2
    const fromY = top + cardHeight
    // 진입점 계층도와 같게, 말단 워크스페이스만 있는 하위는 부모 카드 가운데 아래로 한 줄로 쌓는다.
    if (isLeafRow(node)) {
      let childTop = fromY + LEAF_ROW_GAP
      for (const child of kids) {
        const control = (childTop - fromY) / 2
        edges.push({ parentId: node.id, childId: child.id,
          path: `M ${fromX} ${fromY} C ${fromX} ${fromY + control}, ${fromX} ${childTop - control}, ${fromX} ${childTop}` })
        place(child, fromX - MOVE_CARD_WIDTH / 2, childTop)
        childTop += MOVE_LEAF_CARD_HEIGHT + LEAF_SIBLING_GAP
      }
      return
    }
    // 진입점 계층도와 같게 자식 행은 부모 카드 가운데에 맞춰 놓는다.
    const rowWidth = kids.reduce((sum, child) => sum + (widths.get(child.id) ?? MOVE_CARD_WIDTH), 0)
      + Math.max(0, kids.length - 1) * columnGap
    let childLeft = left + (width - rowWidth) / 2
    for (const child of kids) {
      const childWidth = widths.get(child.id) ?? MOVE_CARD_WIDTH
      const toX = childLeft + childWidth / 2
      const toY = fromY + rowGap
      edges.push({ parentId: node.id, childId: child.id,
        path: `M ${fromX} ${fromY} C ${fromX} ${fromY + rowGap / 2}, ${toX} ${toY - rowGap / 2}, ${toX} ${toY}` })
      place(child, childLeft, toY)
      childLeft += childWidth + columnGap
    }
  }
  const width = root ? measure(root) : 0
  if (root) place(root, 0, 0)
  return { positions, edges, width, height: positions.length ? Math.max(...positions.map((node) => node.y + node.height)) : 0 }
}
