import assert from 'node:assert/strict'
import test from 'node:test'
import {
  collectNodeSubtreeIds,
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
test('루트까지 삭제되어 모든 워크스페이스가 삭제 상태면 휴지통 모드를 고정한다', () => {
  assert.equal(isAllNodesDeleted([]), false)
  assert.equal(isAllNodesDeleted([node(1)]), false)
  assert.equal(isAllNodesDeleted([node(1, { isDeleted: true }), node(2, { parentNodeId: 1, isDeleted: true })]), true)
  assert.equal(isAllNodesDeleted([node(1, { isDeleted: true }), node(2, { parentNodeId: 1 })]), false)
})
