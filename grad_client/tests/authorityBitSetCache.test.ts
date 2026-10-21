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

function createAssignment(): RoleAssignmentRecord {
  return {
    id: 1,
    userId: 'U-16',
    nodeId: 4,
    roleId: 10,
    roleName: '',
    createdAt: timestamp,
  }
}

function createSnapshot(authorities: AuthorityRecord[]): WorkspaceSnapshot {
  return {
    users: [],
    nodes: [
      {
        id: 4,
        nodeType: 'TEAM',
        name: 'Team',
        path: [4],
        createdAt: timestamp,
      },
    ],
    roles: [createAssignment()],
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
