import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeServerWorkspaceDb } from '../renderer/features/workspace/data/localStore.js'
import { normalizeServerContext } from '../renderer/features/workspace/data/server/contextAdapter.js'

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
  assert.equal(item.ownerUserId, 'server-owner-unknown')
  assert.equal(owner?.name, '담당자 미확인')
  assert.equal(owner?.email, 'unknown-owner@local.invalid')
})

test('expanded ID-only owners survive server cache normalization without an invented email', () => {
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
  assert.equal(owner?.email, '')
})
