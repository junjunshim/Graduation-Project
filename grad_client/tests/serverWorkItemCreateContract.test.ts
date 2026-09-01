import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkspaceSnapshot } from '../renderer/features/workspace/model/types.js'
import {
  getServerAssignableUsers,
  getServerAvailableParentItems,
  getServerCreatableNodeIds,
} from '../renderer/features/workspace/queries/serverWorkItemCreateContract.js'

const snapshot: WorkspaceSnapshot = {
  users: [
    { userId: 'requester', email: 'requester@example.com', name: 'Requester', createdAt: '2026-08-29' },
    { userId: 'member', email: 'member@example.com', name: 'Member', createdAt: '2026-08-29' },
    { userId: 'viewer', email: 'viewer@example.com', name: 'Viewer', createdAt: '2026-08-29' },
  ],
  nodes: [
    { id: 10, nodeType: 'TEAM', name: 'Root', path: [10], createdAt: '2026-08-29' },
    { id: 20, parentNodeId: 10, nodeType: 'PROJECT', name: 'Child', path: [10, 20], createdAt: '2026-08-29' },
  ],
  roles: [
    { id: 1, userId: 'requester', nodeId: 10, roleName: 'ADMIN', createdAt: '2026-08-29' },
    { id: 2, userId: 'requester', nodeId: 20, roleName: 'VIEWER', createdAt: '2026-08-29' },
    { id: 3, userId: 'member', nodeId: 10, roleName: 'MEMBER', createdAt: '2026-08-29' },
    { id: 4, userId: 'viewer', nodeId: 10, roleName: 'VIEWER', createdAt: '2026-08-29' },
    { id: 5, userId: 'member', nodeId: 20, roleName: 'MEMBER', createdAt: '2026-08-29' },
  ],
  workItems: [
    {
      workItemId: 'WI-ROOT',
      ownerNodeId: 10,
      ownerUserId: 'member',
      title: 'Root Work',
      description: '',
      status: 'todo',
      priority: 3,
      weight: 1,
      progress: 0,
      createdAt: '2026-08-29',
    },
    {
      workItemId: 'WI-CHILD',
      ownerNodeId: 20,
      ownerUserId: 'member',
      title: 'Child Work',
      description: '',
      status: 'todo',
      priority: 3,
      weight: 1,
      progress: 0,
      createdAt: '2026-08-29',
    },
  ],
}

test('server work item creation options follow direct role requirements', () => {
  assert.deepEqual(Array.from(getServerCreatableNodeIds('requester', snapshot)), [10])
  assert.deepEqual(
    getServerAssignableUsers(10, snapshot).map((user) => user.userId),
    ['requester', 'member'],
  )
  assert.deepEqual(
    getServerAvailableParentItems('requester', [10, 20], snapshot).map((item) => item.workItemId),
    ['WI-ROOT', 'WI-CHILD'],
  )
})
