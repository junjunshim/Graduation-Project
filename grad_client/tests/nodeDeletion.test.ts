import assert from 'node:assert/strict'
import test from 'node:test'
import {
  collectNodeSubtreeIds,
  collectTrashExpandIds,
  countDeletedNodesInSubtree,
  excludeDeletedNodes,
  findDeletedAncestorNode,
  isAllNodesDeleted,
  isRestorableFromTrash,
  selectTrashNodes,
} from '../renderer/features/workspace/model/nodeDeletion.js'
import type { OrganizationNodeRecord } from '../renderer/features/workspace/model/types.js'

function node(
  id: number,
  overrides: Partial<OrganizationNodeRecord> = {},
): OrganizationNodeRecord {
  return {
    id,
    nodeType: 'TEAM',
    name: `Node ${id}`,
    path: [id],
    createdAt: '2026-09-20T00:00:00Z',
    ...overrides,
  }
}

// 1(루트) > 2 > 3,  1 > 4
const tree: OrganizationNodeRecord[] = [
  node(1, { path: [1] }),
  node(2, { path: [1, 2], parentNodeId: 1 }),
  node(3, { path: [1, 2, 3], parentNodeId: 2 }),
  node(4, { path: [1, 4], parentNodeId: 1 }),
]

test('휴지통 화면에는 삭제된 워크스페이스만 표시한다', () => {
  const nodes = [node(1), node(2, { parentNodeId: 1, isDeleted: true }), node(3, { parentNodeId: 2 })]

  assert.deepEqual(selectTrashNodes(nodes).map((item) => item.id), [2])
  assert.deepEqual(excludeDeletedNodes(nodes).map((item) => item.id), [1, 3])
})

test('하위 워크스페이스 ID는 path 와 부모 연결 양쪽으로 수집한다', () => {
  assert.deepEqual(collectNodeSubtreeIds(2, tree).sort((a, b) => a - b), [2, 3])
  assert.deepEqual(collectNodeSubtreeIds(1, tree).sort((a, b) => a - b), [1, 2, 3, 4])
  assert.deepEqual(collectNodeSubtreeIds(4, tree), [4])

  // path 캐시가 비어 있어도 부모 연결을 따라간다.
  const withoutPath = tree.map((item) => ({ ...item, path: [] }))
  assert.deepEqual(collectNodeSubtreeIds(2, withoutPath).sort((a, b) => a - b), [2, 3])
})

test('삭제된 워크스페이스와 그 하위 워크스페이스는 진입이 차단된다', () => {
  const nodes = [node(1), node(2, { parentNodeId: 1 }), node(3, { parentNodeId: 2, path: [1, 2, 3] })]
  nodes[1].isDeleted = true

  assert.equal(findDeletedAncestorNode(2, nodes)?.id, 2)
  assert.equal(findDeletedAncestorNode(3, nodes)?.id, 2)
  assert.equal(findDeletedAncestorNode(1, nodes), null)
  assert.equal(findDeletedAncestorNode(undefined, nodes), null)
  assert.equal(findDeletedAncestorNode(999, nodes), null)
})

test('상위 워크스페이스가 삭제 상태면 먼저 복구해야 한다', () => {
  const parent = node(1, { isDeleted: true })
  const child = node(2, { parentNodeId: 1, isDeleted: true, path: [1, 2] })
  const root = node(10, { isDeleted: true, path: [10] })
  const nodes = [parent, child, root]

  assert.equal(isRestorableFromTrash(child, nodes), false)
  assert.equal(isRestorableFromTrash(parent, nodes), true)
  assert.equal(isRestorableFromTrash(root, nodes), true)
  assert.equal(isRestorableFromTrash(node(20), nodes), false)
})

test('휴지통 개수는 선택한 루트의 하위 트리만 센다', () => {
  const nodes = [
    node(1, { path: [1] }),
    node(2, { parentNodeId: 1, path: [1, 2], isDeleted: true }),
    node(3, { parentNodeId: 2, path: [1, 2, 3], isDeleted: true }),
    node(10, { path: [10] }),
    node(11, { parentNodeId: 10, path: [10, 11], isDeleted: true }),
  ]

  assert.equal(countDeletedNodesInSubtree(1, nodes), 2)
  assert.equal(countDeletedNodesInSubtree(2, nodes), 2)
  assert.equal(countDeletedNodesInSubtree(10, nodes), 1)
  assert.equal(countDeletedNodesInSubtree(999, nodes), 0)
})

test('휴지통 전환 시 삭제된 워크스페이스의 경로만 펼친다', () => {
  const nodes = [
    node(1, { path: [1] }),
    node(2, { parentNodeId: 1, path: [1, 2], isDeleted: true }),
    node(3, { parentNodeId: 2, path: [1, 2, 3], isDeleted: true }),
    node(4, { parentNodeId: 1, path: [1, 4] }),
    node(10, { path: [10] }),
    node(11, { parentNodeId: 10, path: [10, 11], isDeleted: true }),
  ]

  assert.deepEqual(collectTrashExpandIds(1, nodes).sort((a, b) => a - b), [1, 2, 3])
  assert.deepEqual(collectTrashExpandIds(10, nodes).sort((a, b) => a - b), [10, 11])
  assert.deepEqual(collectTrashExpandIds(4, nodes), [])
  assert.deepEqual(collectTrashExpandIds(999, nodes), [])

  // path 캐시가 비어 있어도 부모 연결을 따라간다.
  const withoutPath = nodes.map((item) => ({ ...item, path: [] }))
  assert.deepEqual(collectTrashExpandIds(1, withoutPath).sort((a, b) => a - b), [1, 2, 3])
})
test('루트까지 삭제되어 모든 워크스페이스가 삭제 상태면 휴지통 모드를 고정한다', () => {
  assert.equal(isAllNodesDeleted([]), false)
  assert.equal(isAllNodesDeleted([node(1)]), false)
  assert.equal(isAllNodesDeleted([node(1, { isDeleted: true }), node(2, { parentNodeId: 1, isDeleted: true })]), true)
  assert.equal(isAllNodesDeleted([node(1, { isDeleted: true }), node(2, { parentNodeId: 1 })]), false)
})
