import assert from 'node:assert/strict'
import test from 'node:test'
import { collectDescendantNodeIds, defaultCollapsedNodeIds, layoutNodeMoveTree, projectNodeMoveTree, type MoveTreeNode } from '../renderer/features/workspace/model/nodeMoveTree.js'

const nodes: MoveTreeNode[] = [
  { id: 1, name: 'Root', nodeType: 'COMPANY', path: [1] },
  { id: 2, name: 'Moving', nodeType: 'TEAM', parentNodeId: 1, path: [1, 2] },
  { id: 3, name: 'Child', nodeType: 'TEAM', parentNodeId: 2, path: [1, 2, 3] },
  { id: 4, name: 'Sibling', nodeType: 'TEAM', parentNodeId: 1, path: [1, 4] },
  { id: 10, name: 'Other root', nodeType: 'COMPANY', path: [10] },
]
const moved = (prefix: number[]) => [
  { node_id: 2, name: 'Moving', path: [1, 2], new_path: [...prefix, 2], is_deleted: false },
  { node_id: 3, name: 'Child', path: [1, 2, 3], new_path: [...prefix, 2, 3], is_deleted: false },
  { node_id: 5, name: 'Deleted child', path: [1, 2, 5], new_path: [...prefix, 2, 5], is_deleted: true },
]

test('이전 선택 화면은 서버에서 보완한 하위 공간을 기존 위치에 표시한다', () => {
  const projected = projectNodeMoveTree(nodes, moved([10]), false)
  const layout = layoutNodeMoveTree(projected, 1)
  assert.deepEqual(new Set(layout.positions.map((item) => item.node.id)), new Set([1, 2, 3, 4, 5]))
  assert.equal(projected.find((item) => item.id === 2)?.parentNodeId, 1)
  assert.equal(projected.find((item) => item.id === 5)?.isDeleted, true)
})

test('트리 내부 이전 미리보기는 기존 연결을 끊고 새 부모 아래 전체 하위 트리를 연결한다', () => {
  const projected = projectNodeMoveTree(nodes, moved([1, 4]), true)
  const edges = layoutNodeMoveTree(projected, 1).edges.map((edge) => [edge.parentId, edge.childId])
  assert.deepEqual(edges, [[1, 4], [4, 2], [2, 3], [2, 5]])
  assert.deepEqual(nodes[1].path, [1, 2], '원본 캐시는 변경하지 않는다')
})

test('다른 루트로 이전하면 출발 트리에서 빠지고 목적지 트리에만 표시된다', () => {
  const projected = projectNodeMoveTree(nodes, moved([10]), true)
  assert.deepEqual(layoutNodeMoveTree(projected, 1).positions.map((item) => item.node.id), [1, 4])
  assert.deepEqual(layoutNodeMoveTree(projected, 10).positions.map((item) => item.node.id), [10, 2, 3, 5])
})

test('루트 분리 미리보기는 부모 없는 독립 트리와 하위 공간을 표시한다', () => {
  const projected = projectNodeMoveTree(nodes, moved([]), true)
  assert.equal(projected.find((item) => item.id === 2)?.parentNodeId, undefined)
  assert.deepEqual(layoutNodeMoveTree(projected, 2).positions.map((item) => item.node.id), [2, 3, 5])
})

test('트리 카드들은 겹치지 않고 캔버스 크기 안에 배치된다', () => {
  const layout = layoutNodeMoveTree(projectNodeMoveTree(nodes, moved([1, 4]), true), 1)
  for (const item of layout.positions) {
    assert.ok(item.x >= 0 && item.y >= 0)
    assert.ok(item.x + item.width <= layout.width)
    assert.ok(item.y + item.height <= layout.height)
    for (const other of layout.positions) {
      if (item.node.id === other.node.id) continue
      assert.ok(item.x + item.width <= other.x || other.x + other.width <= item.x || item.y + item.height <= other.y || other.y + other.height <= item.y)
    }
  }
})

test('collapsing hides descendants without altering the move projection', () => {
  const projected = projectNodeMoveTree(nodes, moved([10]), false)
  const folded = layoutNodeMoveTree(projected, 1, new Set([2]))
  assert.deepEqual(folded.positions.map(item => item.node.id), [1, 2, 4])
  assert.deepEqual(folded.edges.map(edge => [edge.parentId, edge.childId]), [[1, 2], [1, 4]])
  assert.deepEqual(layoutNodeMoveTree(projected, 1, new Set([1])).positions.map(item => item.node.id), [1])
  assert.deepEqual(layoutNodeMoveTree(projected, 1).positions.map(item => item.node.id), [1, 2, 3, 5, 4])
  assert.equal(projected.find(item => item.id === 3)?.parentNodeId, 2)
})

const nestedTree: MoveTreeNode[] = [
  { id: 1, name: 'Root', nodeType: 'COMPANY', path: [1] },
  { id: 2, name: 'A', nodeType: 'DIVISION', parentNodeId: 1, path: [1, 2] },
  { id: 3, name: 'A1', nodeType: 'TEAM', parentNodeId: 2, path: [1, 2, 3] },
  { id: 4, name: 'A1a', nodeType: 'TEAM', parentNodeId: 3, path: [1, 2, 3, 4] },
  { id: 5, name: 'B', nodeType: 'DIVISION', parentNodeId: 1, path: [1, 5] },
  { id: 6, name: 'B1', nodeType: 'TEAM', parentNodeId: 5, path: [1, 5, 6] },
]

test('처음에는 탐색할 루트의 직계 하위만 펼친다', () => {
  const collapsed = defaultCollapsedNodeIds(nestedTree, 1, 999)
  assert.deepEqual(collapsed, new Set([2, 3, 5]))
  assert.deepEqual(layoutNodeMoveTree(nestedTree, 1, collapsed).positions.map(item => item.node.id), [1, 2, 5])
})

test('처음에는 이전할 워크스페이스의 현재 위치까지 내려가는 길과 그 직계 하위만 펼친다', () => {
  const collapsed = defaultCollapsedNodeIds(nestedTree, 1, 4)
  assert.deepEqual(collapsed, new Set([5]))
  assert.deepEqual(layoutNodeMoveTree(nestedTree, 1, collapsed).positions.map(item => item.node.id), [1, 2, 3, 4, 5])
})

test('펼침/접힘 애니메이션은 접거나 펼친 노드의 모든 자손 카드에 적용한다', () => {
  assert.deepEqual(collectDescendantNodeIds(nestedTree, [2]), new Set([3, 4]))
  assert.deepEqual(collectDescendantNodeIds(nestedTree, [1, 5]), new Set([2, 3, 4, 5, 6]))
  assert.deepEqual(collectDescendantNodeIds(nestedTree, [4]), new Set())
})

const rootAndTwins: MoveTreeNode[] = [
  { id: 1, name: 'Root', nodeType: 'COMPANY', path: [1] },
  { id: 2, name: 'A', nodeType: 'TEAM', parentNodeId: 1, path: [1, 2] },
  { id: 3, name: 'B', nodeType: 'TEAM', parentNodeId: 1, path: [1, 3] },
]

test('루트의 직계 자식 행은 진입점 계층도와 같은 간격으로 루트 카드 가운데에 놓인다', () => {
  const layout = layoutNodeMoveTree(rootAndTwins, 1)
  const rootCard = layout.positions.find((item) => item.node.id === 1)!
  const first = layout.positions.find((item) => item.node.id === 2)!
  const second = layout.positions.find((item) => item.node.id === 3)!
  // 루트 카드와 직계 자식 사이는 진입점 dendroChildrenRow 의 padding-top(100px)과 같다.
  assert.ok(Math.abs(first.y - (rootCard.y + rootCard.height) - 100) < 0.001)
  // 형제 카드 사이는 진입점 dendroChildrenRow 의 gap(0.85rem = 14.45px)과 같다.
  assert.ok(Math.abs(second.x - (first.x + first.width) - 14.45) < 0.001)
  // 자식 행 가운데가 루트 카드 가운데와 맞아 연결선이 곧게 내려간다.
  assert.ok(Math.abs((first.x + second.x + second.width) / 2 - (rootCard.x + rootCard.width / 2)) < 0.001)
})

test('자식이 하나뿐이어도 부모 카드 가운데 아래에 곧게 놓인다', () => {
  const only: MoveTreeNode = { id: 2, name: 'Only', nodeType: 'TEAM', parentNodeId: 1, path: [1, 2] }
  const layout = layoutNodeMoveTree([rootAndTwins[0], only], 1)
  const rootCard = layout.positions.find((item) => item.node.id === 1)!
  const child = layout.positions.find((item) => item.node.id === 2)!
  assert.ok(Math.abs(child.x + child.width / 2 - (rootCard.x + rootCard.width / 2)) < 0.001)
})

const leafOnlyTree: MoveTreeNode[] = [
  { id: 1, name: 'Root', nodeType: 'COMPANY', path: [1] },
  { id: 2, name: 'Parent', nodeType: 'DIVISION', parentNodeId: 1, path: [1, 2] },
  { id: 3, name: 'Leaf A', nodeType: 'TEAM', parentNodeId: 2, path: [1, 2, 3] },
  { id: 4, name: 'Leaf B', nodeType: 'TEAM', parentNodeId: 2, path: [1, 2, 4] },
]

test('말단 워크스페이스만 있는 하위는 진입점 계층도처럼 한 줄로 세로로 쌓는다', () => {
  const layout = layoutNodeMoveTree(leafOnlyTree, 1)
  const parent = layout.positions.find((item) => item.node.id === 2)!
  const first = layout.positions.find((item) => item.node.id === 3)!
  const second = layout.positions.find((item) => item.node.id === 4)!
  // 형제가 같은 세로줄에서 부모 카드 가운데 아래에 놓인다.
  assert.equal(first.x, second.x)
  assert.ok(Math.abs(first.x + first.width / 2 - (parent.x + parent.width / 2)) < 0.001)
  // 첫 자식까지는 dendroChildrenRowVertical 의 padding-top(4.2rem = 71.4px)과 같다.
  assert.ok(Math.abs(first.y - (parent.y + parent.height) - 71.4) < 0.001)
  // 형제 사이는 dendroChildrenRowVertical 의 gap(1.5rem = 25.5px)과 같다.
  assert.ok(Math.abs(second.y - (first.y + first.height) - 25.5) < 0.001)
})
