import assert from 'node:assert/strict'
import test from 'node:test'
import { parseServerContextItems } from '../renderer/features/workspace/data/server/apiTypes.js'
import { normalizeServerContext } from '../renderer/features/workspace/data/server/contextAdapter.js'

test('checked-in compact context response is normalized without inventing the current user as owner', () => {
  const result = normalizeServerContext(
    [
      {
        type: 'NODE',
        id: '10',
        node_type: 'TEAM',
        title: 'Axis',
        extra_info: '{10}',
        updated_at: '2026-08-29 01:00:00+00',
      },
      {
        type: 'ROLE',
        id: '5',
        parent_id: '10',
        title: 'viewer@example.com',
        status: 'VIEWER',
        updated_at: '2026-08-29 01:00:00+00',
      },
      {
        type: 'WORK_ITEM',
        id: 'WI-PARENT',
        parent_id: '10',
        title: '상위 업무',
        status: 'doing',
        priority: 1,
        updated_at: '2026-08-29 02:00:00+00',
      },
      {
        type: 'WORK_ITEM',
        id: 'WI-CHILD',
        parent_id: '10',
        title: '하위 업무',
        status: 'end',
        priority: 5,
        extra_info: 'WI-PARENT',
        updated_at: '2026-08-29 03:00:00+00',
      },
    ],
    'signed-in@example.com',
  )

  assert.equal(result.workspace.nodes[0]?.id, 10)
  assert.deepEqual(result.workspace.nodes[0]?.path, [10])
  assert.equal(result.workspace.roles[0]?.roleName, 'VIEWER')
  assert.equal(result.workspace.workItems[0]?.status, 'in-progress')
  assert.equal(result.workspace.workItems[1]?.status, 'done')
  assert.equal(result.workspace.workItems[1]?.parentWorkItemId, 'WI-PARENT')
  assert.equal(result.workspace.workItems[1]?.ownerUserId, 'server-owner-unknown')
  assert.notEqual(result.workspace.workItems[1]?.ownerUserId, 'signed-in@example.com')
  assert.equal(result.lastUpdatedAt, '2026-08-29 03:00:00+00')
})

test('documented expanded response fields are preserved when the server provides them', () => {
  const result = normalizeServerContext(
    [
      {
        type: 'NODE',
        id: 20,
        node_type: 'PROJECT',
        title: 'Graduation',
        path: [20],
        updated_at: '2026-08-29T00:00:00Z',
      },
      {
        type: 'ROLE',
        id: 8,
        node_id: 20,
        user_email: 'owner@example.com',
        role_name: 'ADMIN',
        updated_at: '2026-08-29T00:00:00Z',
      },
      {
        type: 'WORK_ITEM',
        id: 'WI-20',
        owner_node_id: 20,
        owner_user_id: 'U-20',
        owner_user_email: 'owner@example.com',
        title: '실제 상세 업무',
        description: '서버 설명',
        status: 'in_progress',
        priority: 2,
        weight: 0,
        progress: 75,
        start_date: '2026-08-29',
        due_date: '2026-08-30',
        updated_at: '2026-08-29T00:00:00Z',
      },
    ],
    'owner@example.com',
  )

  const item = result.workspace.workItems[0]
  assert.equal(result.workspace.users.filter((user) => user.email === 'owner@example.com').length, 1)
  assert.equal(result.workspace.roles[0]?.userId, 'U-20')
  assert.equal(item?.ownerNodeId, 20)
  assert.equal(item?.ownerUserId, 'U-20')
  assert.equal(item?.description, '서버 설명')
  assert.equal(item?.weight, 0)
  assert.equal(item?.progress, 75)
  assert.equal(item?.startDate, '2026-08-29')
  assert.equal(item?.dueDate, '2026-08-30')
})

test('an empty context is valid and still keeps the authenticated identity', () => {
  const result = normalizeServerContext([], 'empty@example.com')

  assert.equal(result.workspace.users[0]?.email, 'empty@example.com')
  assert.equal(result.workspace.nodes.length, 0)
  assert.equal(result.workspace.roles.length, 0)
  assert.equal(result.workspace.workItems.length, 0)
})

test('malformed context envelopes are rejected instead of being treated as empty data', () => {
  assert.throws(() => parseServerContextItems(undefined), /data가 배열 형식이 아닙니다/)
  assert.throws(() => parseServerContextItems([null]), /1번째 항목 형식이 올바르지 않습니다/)
})

test('context records with missing required references report normalization issues', () => {
  const result = normalizeServerContext(
    [
      {
        type: 'ROLE',
        id: 1,
        parent_id: 999,
        title: 'orphan@example.com',
        status: 'MEMBER',
      },
    ],
    'signed-in@example.com',
  )

  assert.equal(result.workspace.roles.length, 0)
  assert.match(result.issues[0]?.message ?? '', /참조하는 노드/)
})

test('missing, unsupported, and incomplete context item types report normalization issues', () => {
  const result = normalizeServerContext(
    [{}, { type: 'BROKEN' }, { type: 'USER' }],
    'signed-in@example.com',
  )

  assert.equal(result.issues.length, 3)
  assert.match(result.issues[0]?.message ?? '', /type이 없어/)
  assert.match(result.issues[1]?.message ?? '', /지원하지 않는/)
  assert.match(result.issues[2]?.message ?? '', /사용자 ID 또는 이메일/)
})

test('partial sync records can reference cached nodes and preserve omitted work item details', () => {
  const referenceWorkspace = {
    datasetId: 'server-workspace',
    seedVersion: 1,
    users: [
      {
        userId: 'signed-in@example.com',
        email: 'signed-in@example.com',
        name: 'Signed In',
        createdAt: '2026-08-01T00:00:00Z',
      },
    ],
    nodes: [
      {
        id: 10,
        nodeType: 'TEAM' as const,
        name: 'Cached Team',
        path: [10],
        createdAt: '2026-08-01T00:00:00Z',
      },
    ],
    roles: [],
    workItems: [
      {
        workItemId: 'WI-PARENT',
        ownerNodeId: 10,
        ownerUserId: 'signed-in@example.com',
        title: 'Cached Parent',
        description: 'parent',
        status: 'todo' as const,
        priority: 3,
        weight: 1,
        progress: 0,
        createdAt: '2026-08-01T00:00:00Z',
      },
      {
        workItemId: 'WI-CHILD',
        ownerNodeId: 10,
        ownerUserId: 'signed-in@example.com',
        title: 'Before Sync',
        description: '보존할 상세 설명',
        status: 'in-progress' as const,
        priority: 3,
        weight: 7,
        progress: 65,
        startDate: '2026-08-01',
        dueDate: '2026-09-01',
        parentWorkItemId: 'WI-PARENT',
        createdAt: '2026-08-01T00:00:00Z',
      },
    ],
    counters: { node: 11, role: 1 },
  }

  const result = normalizeServerContext(
    [
      {
        type: 'ROLE',
        id: 4,
        parent_id: 10,
        title: 'signed-in@example.com',
        status: 'MANAGER',
      },
      {
        type: 'WORK_ITEM',
        id: 'WI-CHILD',
        parent_id: 10,
        title: 'After Sync',
        status: 'done',
        priority: 2,
        extra_info: 'WI-PARENT',
        updated_at: '2026-08-29T00:00:00Z',
      },
    ],
    'signed-in@example.com',
    { referenceWorkspace },
  )

  const item = result.workspace.workItems[0]
  assert.equal(result.issues.length, 0)
  assert.equal(result.workspace.roles[0]?.nodeId, 10)
  assert.equal(item?.ownerUserId, 'signed-in@example.com')
  assert.equal(item?.description, '보존할 상세 설명')
  assert.equal(item?.weight, 7)
  assert.equal(item?.progress, 65)
  assert.equal(item?.startDate, '2026-08-01')
  assert.equal(item?.dueDate, '2026-09-01')
  assert.equal(item?.parentWorkItemId, 'WI-PARENT')
})
