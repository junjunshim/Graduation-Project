import assert from 'node:assert/strict'
import test from 'node:test'
import { getWorkspaceOverview } from '../renderer/features/workspace/queries/workspaceOverview.js'
import type { WorkspaceSnapshot } from '../renderer/features/workspace/model/types.js'

const timestamp = '2026-10-21T00:00:00.000Z'

function createSnapshot(): WorkspaceSnapshot {
  return {
    users: [
      {
        userId: 'u1',
        email: 'u1@example.com',
        name: 'User 1',
        personalNodeId: 10,
        createdAt: timestamp,
      },
    ],
    nodes: [
      {
        id: 1,
        nodeType: 'TEAM',
        name: 'Root',
        path: [1],
        createdAt: timestamp,
      },
      {
        id: 2,
        parentNodeId: 1,
        nodeType: 'TEAM',
        name: 'Child',
        path: [1, 2],
        createdAt: timestamp,
      },
    ],
    roles: [],
    workItems: [
      {
        workItemId: 'WI-1',
        ownerNodeId: 1,
        ownerUserId: 'u1',
        title: 'Work 1',
        description: '',
        status: 'todo',
        priority: 3,
        weight: 0,
        progress: 0,
        computedProgress: 0,
        createdAt: timestamp,
      },
      {
        workItemId: 'WI-2',
        ownerNodeId: 2,
        ownerUserId: 'u1',
        title: 'Work 2',
        description: '',
        status: 'todo',
        priority: 3,
        weight: 0,
        progress: 0,
        computedProgress: 0,
        createdAt: timestamp,
      },
    ],
    authorities: [],
    mentions: [],
    activities: [],
    files: [],
  }
}

test('workspace overview reuses calculations for the same snapshot and options', () => {
  const snapshot = createSnapshot()
  const fullOverview = getWorkspaceOverview('u1', snapshot)

  assert.equal(getWorkspaceOverview('u1', snapshot), fullOverview)

  const scopedOverview = getWorkspaceOverview('u1', snapshot, {
    rootNodeId: '2',
    singleNodeOnly: true,
  })

  assert.notEqual(scopedOverview, fullOverview)
  assert.deepEqual(scopedOverview.visibleNodes.map((node) => node.id), [2])
  assert.equal(
    getWorkspaceOverview('u1', snapshot, { rootNodeId: '2', singleNodeOnly: true }),
    scopedOverview,
  )
})

test('workspace overview cache is isolated by snapshot identity', () => {
  const snapshot = createSnapshot()
  const firstOverview = getWorkspaceOverview('u1', snapshot)
  const nextSnapshot: WorkspaceSnapshot = {
    ...snapshot,
    workItems: snapshot.workItems.map((item) => ({ ...item })),
  }

  assert.notEqual(getWorkspaceOverview('u1', nextSnapshot), firstOverview)
})
