import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeServerWorkspaceDb } from '../renderer/features/workspace/data/localStore.js'
import { normalizeServerContext } from '../renderer/features/workspace/data/server/contextAdapter.js'
import { getWorkItemDisplayCode } from '../renderer/features/workspace/model/formatters.js'

test('compact server work items survive context adapter and cache normalization round trips', () => {
  const adapted = normalizeServerContext(
    [
      {
        type: 'NODE',
        id: 10,
        node_type: 'TEAM',
        title: 'Round Trip Team',
        extra_info: '{10}',
      },
      {
        type: 'WORK_ITEM',
        id: 'WI-ROUND-TRIP',
        display_id: 7,
        parent_id: 10,
        title: 'Round Trip Work',
        status: 'doing',
        priority: 2,
      },
    ],
    'signed-in@example.com',
  )

  const cached = normalizeServerWorkspaceDb(JSON.parse(JSON.stringify(adapted.workspace)))
  const item = cached.workItems.find((candidate) => candidate.workItemId === 'WI-ROUND-TRIP')
  const owner = cached.users.find((candidate) => candidate.userId === item?.ownerUserId)

  assert.ok(item)
  assert.equal(item.displayId, 7)
  assert.equal(item.workItemId, 'WI-ROUND-TRIP')
  assert.equal(getWorkItemDisplayCode(item), 'WI-7')
  assert.equal(item.ownerUserId, 'server-owner-unknown')
  assert.equal(owner?.name, '담당자 미확인')
  assert.equal(owner?.email, 'unknown-owner@local.invalid')
})

test('expanded ID-only owners keep a generated placeholder email through cache normalization', () => {
  const adapted = normalizeServerContext(
    [
      {
        type: 'NODE',
        id: 20,
        node_type: 'PROJECT',
        title: 'Expanded Team',
        path: [20],
      },
      {
        type: 'WORK_ITEM',
        id: 'WI-ID-OWNER',
        owner_node_id: 20,
        owner_user_id: 'U-12',
        title: 'ID-only Owner Work',
      },
    ],
    'signed-in@example.com',
  )

  const cached = normalizeServerWorkspaceDb(JSON.parse(JSON.stringify(adapted.workspace)))
  const item = cached.workItems.find((candidate) => candidate.workItemId === 'WI-ID-OWNER')
  const owner = cached.users.find((candidate) => candidate.userId === 'U-12')

  assert.ok(item)
  assert.equal(item.ownerUserId, 'U-12')
  assert.equal(owner?.email, 'u-12@local.generated')
})

test('cache normalization resolves nested, missing-parent, and explicit node paths', () => {
  const cached = normalizeServerWorkspaceDb({
    datasetId: 'node-path-test',
    seedVersion: 1,
    users: [],
    nodes: [
      { id: 1, node_type: 'TEAM', name: 'Root', path: [] },
      { id: 2, parent_node_id: 1, node_type: 'TEAM', name: 'Child', path: [] },
      { id: 3, parent_node_id: 2, node_type: 'PROJECT', name: 'Grandchild', path: [] },
      { id: 4, parent_node_id: 99, node_type: 'PROJECT', name: 'Missing parent', path: [] },
      { id: 5, node_type: 'USER', name: 'User node', path: [5] },
      { id: 6, parent_node_id: 5, node_type: 'PROJECT', name: 'User project', path: [] },
      { id: 7, parent_node_id: 1, node_type: 'PROJECT', name: 'Explicit path', path: [1, 7] },
      { id: 8, parent_node_id: 7, node_type: 'PROJECT', name: 'Below explicit path', path: [] },
    ],
    roles: [],
    workItems: [],
  })
  const paths = new Map(cached.nodes.map((node) => [node.id, node.path]))

  assert.deepEqual(paths.get(1), [1])
  assert.deepEqual(paths.get(2), [1, 2])
  assert.deepEqual(paths.get(3), [1, 2, 3])
  assert.deepEqual(paths.get(4), [99, 4])
  assert.deepEqual(paths.get(5), [5])
  assert.deepEqual(paths.get(6), [5, 6])
  assert.deepEqual(paths.get(7), [1, 7])
  assert.deepEqual(paths.get(8), [1, 7, 8])
})

test('cache normalization reuses a single pass for a deep node chain', () => {
  const depth = 500
  const cached = normalizeServerWorkspaceDb({
    datasetId: 'node-depth-test',
    seedVersion: 1,
    users: [],
    nodes: Array.from({ length: depth }, (_, index) => {
      const id = index + 1

      return {
        id,
        ...(id > 1 ? { parent_node_id: id - 1 } : {}),
        node_type: 'PROJECT',
        name: `Node ${id}`,
        path: [],
      }
    }),
    roles: [],
    workItems: [],
  })
  const lastNode = cached.nodes[cached.nodes.length - 1]

  assert.equal(lastNode.path.length, depth)
  assert.equal(lastNode.path[0], 1)
  assert.equal(lastNode.path[depth - 1], depth)
})

test('cache normalization selects the first top role on a personal user node', () => {
  const cached = normalizeServerWorkspaceDb({
    datasetId: 'personal-node-test',
    seedVersion: 1,
    users: [{ userId: 'U-1', email: 'user@example.com', name: 'User' }],
    nodes: [
      { id: 1, node_type: 'TEAM', name: 'Team', path: [1] },
      { id: 10, parent_node_id: 1, node_type: 'USER', name: 'User node', path: [1, 10] },
    ],
    roles: [
      { user_id: 'U-1', node_id: 10, is_top_role: true, role: 'MEMBER' },
      { user_id: 'U-1', node_id: 1, is_top_role: true, role: 'MEMBER' },
    ],
    workItems: [],
  })

  assert.equal(cached.users[0]?.personalNodeId, 10)
})
