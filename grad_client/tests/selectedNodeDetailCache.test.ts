import assert from 'node:assert/strict'
import test from 'node:test'
import { stringifyAuthorityBitSet } from '../renderer/features/workspace/model/authorityDefinitions.js'
import type {
  OrganizationNodeRecord,
  WorkspaceSnapshot,
} from '../renderer/features/workspace/model/types.js'
import { getSelectedNodeDetail } from '../renderer/features/workspace/queries/selectedNodeDetail.js'

const timestamp = '2026-10-21T00:00:00.000Z'

function createNodes(): OrganizationNodeRecord[] {
  return [
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
      nodeType: 'PROJECT',
      name: 'Child',
      path: [1, 2],
      createdAt: timestamp,
    },
  ]
}

function createSnapshot(nodes = createNodes()): WorkspaceSnapshot {
  return {
    users: [
      {
        userId: 'U-1',
        email: 'user@example.com',
        name: 'User One',
        createdAt: timestamp,
      },
    ],
    nodes,
    roles: [
      {
        id: 1,
        userId: 'U-1',
        nodeId: 1,
        roleId: 10,
        roleName: 'MANAGER',
        createdAt: timestamp,
      },
    ],
    workItems: [
      {
        workItemId: 'WI-1',
        ownerNodeId: 2,
        ownerUserId: 'U-1',
        title: 'Work',
        description: '',
        status: 'todo',
        priority: 3,
        weight: 0,
        progress: 0,
        createdAt: timestamp,
      },
    ],
    authorities: [
      {
        id: 10,
        nodeId: 1,
        roleName: 'MANAGER',
        authority: stringifyAuthorityBitSet(new Set([15])),
      },
    ],
    mentions: [],
    activities: [],
    files: [],
  }
}

test('selected node detail is reused for the same snapshot, node, user, and options', () => {
  let nodeFindCount = 0
  const nodes = new Proxy<OrganizationNodeRecord[]>(createNodes(), {
    get(target, property, receiver) {
      if (property === 'find') {
        nodeFindCount += 1
      }
      return Reflect.get(target, property, receiver)
    },
  })
  const snapshot = createSnapshot(nodes)
  const first = getSelectedNodeDetail(1, 'U-1', snapshot, {
    requireDirectManagementRole: true,
  })
  const findCountAfterFirst = nodeFindCount

  assert.ok(first)
  assert.equal(first.canManage, true)
  assert.equal(getSelectedNodeDetail(1, 'U-1', snapshot, {
    requireDirectManagementRole: true,
  }), first)
  assert.equal(nodeFindCount, findCountAfterFirst)
})

test('direct-management and inherited-management details have separate cache entries', () => {
  const snapshot = createSnapshot()
  const inherited = getSelectedNodeDetail(2, 'U-1', snapshot, {
    requireDirectManagementRole: false,
  })
  const direct = getSelectedNodeDetail(2, 'U-1', snapshot, {
    requireDirectManagementRole: true,
  })

  assert.ok(inherited)
  assert.ok(direct)
  assert.notEqual(direct, inherited)
  assert.equal(inherited.canManage, true)
  assert.equal(inherited.inheritedManagers[0]?.userId, 'U-1')
  assert.equal(direct.canManage, false)
})

test('selected node detail cache is isolated by snapshot identity', () => {
  const first = getSelectedNodeDetail(1, 'U-1', createSnapshot())
  const second = getSelectedNodeDetail(1, 'U-1', createSnapshot())

  assert.ok(first)
  assert.ok(second)
  assert.notEqual(second, first)
})
