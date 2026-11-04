import assert from 'node:assert/strict'
import test from 'node:test'
import { getNodePathLabel } from '../renderer/features/workspace/data/orgService.js'
import { getSelectedWorkItemDetail } from '../renderer/features/workspace/queries/selectedWorkItemDetail.js'
import type {
  OrganizationNodeRecord,
  WorkItemRecord,
  WorkspaceSnapshot,
} from '../renderer/features/workspace/model/types.js'

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
      nodeType: 'TEAM',
      name: 'Child',
      path: [1, 2],
      createdAt: timestamp,
    },
  ]
}

function createWorkItems(): WorkItemRecord[] {
  return [
    {
      workItemId: 'WI-1',
      ownerNodeId: 1,
      ownerUserId: 'U-1',
      title: 'Parent',
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
      ownerUserId: 'U-1',
      title: 'Child work',
      description: '',
      status: 'todo',
      priority: 3,
      weight: 0,
      progress: 0,
      computedProgress: 0,
      parentWorkItemId: 'WI-1',
      createdAt: timestamp,
    },
  ]
}

function createSnapshot(workItems: WorkItemRecord[]): WorkspaceSnapshot {
  return {
    users: [
      {
        userId: 'U-1',
        email: 'u1@example.com',
        name: 'User 1',
        createdAt: timestamp,
      },
    ],
    nodes: createNodes(),
    roles: [],
    workItems,
    authorities: [],
    mentions: [],
    activities: [],
    files: [],
  }
}

test('selected work item detail is reused for the same snapshot and work item', () => {
  let filterCount = 0
  const workItems = new Proxy<WorkItemRecord[]>(createWorkItems(), {
    get(target, property, receiver) {
      if (property === 'filter') {
        filterCount += 1
      }
      return Reflect.get(target, property, receiver)
    },
  })
  const snapshot = createSnapshot(workItems)
  const first = getSelectedWorkItemDetail('WI-1', 'U-1', snapshot)
  const filterCountAfterFirst = filterCount

  assert.ok(first)
  assert.equal(getSelectedWorkItemDetail('WI-1', 'U-1', snapshot), first)
  assert.equal(filterCount, filterCountAfterFirst)

  const second = getSelectedWorkItemDetail('WI-2', 'U-1', snapshot)

  assert.ok(second)
  assert.equal(second.parentWorkItem, first.item)
  assert.equal(second.ownerNodePathLabel, 'Root / Child')

  const filterCountAfterSecond = filterCount
  assert.equal(getSelectedWorkItemDetail('WI-2', 'U-1', snapshot), second)
  assert.equal(filterCount, filterCountAfterSecond)
})

test('selected work item detail cache is isolated by snapshot identity', () => {
  const firstSnapshot = createSnapshot(createWorkItems())
  const secondSnapshot = createSnapshot(createWorkItems())

  const first = getSelectedWorkItemDetail('WI-1', 'U-1', firstSnapshot)
  const second = getSelectedWorkItemDetail('WI-1', 'U-1', secondSnapshot)

  assert.ok(first)
  assert.ok(second)
  assert.notEqual(second, first)
})

test('node path labels reuse the node index for the same node array', () => {
  let iteratorCount = 0
  const nodes = new Proxy<OrganizationNodeRecord[]>(createNodes(), {
    get(target, property, receiver) {
      if (property === Symbol.iterator) {
        iteratorCount += 1
      }
      return Reflect.get(target, property, receiver)
    },
  })

  assert.equal(getNodePathLabel(2, nodes), 'Root / Child')
  const iteratorCountAfterFirst = iteratorCount

  assert.equal(getNodePathLabel(1, nodes), 'Root')
  assert.equal(iteratorCount, iteratorCountAfterFirst)
})
