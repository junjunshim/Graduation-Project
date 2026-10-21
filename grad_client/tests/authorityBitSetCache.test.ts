import assert from 'node:assert/strict'
import test from 'node:test'
import { stringifyAuthorityBitSet } from '../renderer/features/workspace/model/authorityDefinitions.js'
import {
  getDirectAuthorityBitSet,
  getEffectiveAuthorityBitSet,
} from '../renderer/features/workspace/model/effectiveAuthority.js'
import type {
  AuthorityRecord,
  RoleAssignmentRecord,
  WorkspaceSnapshot,
} from '../renderer/features/workspace/model/types.js'

const timestamp = '2026-10-21T00:00:00.000Z'

function createAssignment(
  userId = 'U-16',
  nodeId = 4,
  roleId = 10,
  id = 1,
): RoleAssignmentRecord {
  return {
    id,
    userId,
    nodeId,
    roleId,
    roleName: '',
    createdAt: timestamp,
  }
}

function createSnapshot(
  authorities: AuthorityRecord[],
  roles: RoleAssignmentRecord[] = [createAssignment()],
  nodes: WorkspaceSnapshot['nodes'] = [
    {
      id: 4,
      nodeType: 'TEAM',
      name: 'Team',
      path: [4],
      createdAt: timestamp,
    },
  ],
): WorkspaceSnapshot {
  return {
    users: [],
    nodes,
    roles,
    workItems: [],
    authorities,
    mentions: [],
    activities: [],
    files: [],
  }
}

test('authority bit sets are reused per snapshot without exposing the cached set', () => {
  let authorityLookupCount = 0
  const authorities = new Proxy<AuthorityRecord[]>(
    [
      {
        id: 10,
        nodeId: 4,
        roleName: 'MANAGER',
        authority: stringifyAuthorityBitSet(new Set([0, 1, 4, 8, 14])),
      },
    ],
    {
      get(target, property, receiver) {
        if (property === 'find') {
          authorityLookupCount += 1
        }
        return Reflect.get(target, property, receiver)
      },
    },
  )
  const snapshot = createSnapshot(authorities)

  const firstEffective = getEffectiveAuthorityBitSet('U-16', 4, snapshot)
  const lookupCountAfterFirstEffective = authorityLookupCount

  assert.equal(firstEffective.has(14), true)
  assert.equal(getEffectiveAuthorityBitSet('u-16', 4, snapshot).has(14), true)
  assert.equal(authorityLookupCount, lookupCountAfterFirstEffective)

  firstEffective.clear()
  assert.equal(getEffectiveAuthorityBitSet('U-16', 4, snapshot).has(14), true)

  const firstDirect = getDirectAuthorityBitSet('U-16', 4, snapshot)
  const lookupCountAfterFirstDirect = authorityLookupCount

  assert.equal(firstDirect.has(14), true)
  assert.equal(getDirectAuthorityBitSet('u-16', 4, snapshot).has(14), true)
  assert.equal(authorityLookupCount, lookupCountAfterFirstDirect)

  firstDirect.clear()
  assert.equal(getDirectAuthorityBitSet('U-16', 4, snapshot).has(14), true)
})

test('authority bit set cache is isolated by snapshot identity', () => {
  const authorities: AuthorityRecord[] = [
    {
      id: 10,
      nodeId: 4,
      roleName: 'MANAGER',
      authority: stringifyAuthorityBitSet(new Set([0, 1, 4, 8, 14])),
    },
  ]
  const firstSnapshot = createSnapshot(authorities)
  const secondSnapshot = createSnapshot(authorities)

  const first = getEffectiveAuthorityBitSet('U-16', 4, firstSnapshot)
  first.clear()

  assert.equal(getEffectiveAuthorityBitSet('U-16', 4, firstSnapshot).has(14), true)
  assert.equal(getEffectiveAuthorityBitSet('U-16', 4, secondSnapshot).has(14), true)
})

test('authority indexes are built once for multiple user and node checks', () => {
  let roleScanCount = 0
  let authorityScanCount = 0
  const roles = new Proxy<RoleAssignmentRecord[]>(
    [createAssignment(), createAssignment('U-17', 4, 11, 2)],
    {
      get(target, property, receiver) {
        if (property === 'forEach') {
          roleScanCount += 1
        }
        return Reflect.get(target, property, receiver)
      },
    },
  )
  const authorities = new Proxy<AuthorityRecord[]>(
    [
      {
        id: 10,
        nodeId: 4,
        roleName: 'MANAGER',
        authority: stringifyAuthorityBitSet(new Set([0, 1, 4, 8, 14])),
      },
      {
        id: 11,
        nodeId: 4,
        roleName: 'VIEWER',
        authority: stringifyAuthorityBitSet(new Set([0, 4])),
      },
    ],
    {
      get(target, property, receiver) {
        if (property === 'forEach') {
          authorityScanCount += 1
        }
        return Reflect.get(target, property, receiver)
      },
    },
  )
  const snapshot = createSnapshot(authorities, roles)

  assert.equal(getEffectiveAuthorityBitSet('U-16', 4, snapshot).has(14), true)
  assert.equal(getEffectiveAuthorityBitSet('U-17', 4, snapshot).has(1), false)
  assert.equal(getDirectAuthorityBitSet('U-16', 4, snapshot).has(14), true)
  assert.equal(roleScanCount, 1)
  assert.equal(authorityScanCount, 1)
})

test('nearest ancestor role wins without leaking another user role', () => {
  const nodes: WorkspaceSnapshot['nodes'] = [
    { id: 1, nodeType: 'TEAM', name: 'Root', path: [1], createdAt: timestamp },
    { id: 2, parentNodeId: 1, nodeType: 'TEAM', name: 'Middle', path: [1, 2], createdAt: timestamp },
    { id: 3, parentNodeId: 2, nodeType: 'PROJECT', name: 'Leaf', path: [1, 2, 3], createdAt: timestamp },
  ]
  const authorities: AuthorityRecord[] = [
    {
      id: 10,
      nodeId: 1,
      roleName: 'MANAGER',
      authority: stringifyAuthorityBitSet(new Set([0, 4])),
    },
    {
      id: 11,
      nodeId: 2,
      roleName: 'MEMBER',
      authority: stringifyAuthorityBitSet(new Set([0, 8])),
    },
    {
      id: 12,
      nodeId: 2,
      roleName: 'MEMBER',
      authority: stringifyAuthorityBitSet(new Set([0, 10])),
    },
  ]
  const roles = [
    createAssignment('U-20', 1, 10, 1),
    createAssignment('U-20', 2, 11, 2),
    createAssignment('U-21', 2, 12, 3),
  ]
  const snapshot = createSnapshot(authorities, roles, nodes)
  const effective = getEffectiveAuthorityBitSet('u-20', 3, snapshot)

  assert.equal(effective.has(8), true)
  assert.equal(effective.has(4), false)
  assert.equal(effective.has(10), false)
  assert.equal(getDirectAuthorityBitSet('U-20', 3, snapshot).size, 0)
})
