import assert from 'node:assert/strict'
import test from 'node:test'
import { stringifyAuthorityBitSet } from '../renderer/features/workspace/model/authorityDefinitions.js'
import {
  analyzeWorkspaceMembers,
  getRolePriorityScore,
} from '../renderer/features/workspace/model/memberInheritance.js'
import type {
  AuthorityRecord,
  OrganizationNodeRecord,
  RoleAssignmentRecord,
  RoleName,
  UserRecord,
} from '../renderer/features/workspace/model/types.js'

const timestamp = '2026-10-21T00:00:00.000Z'
const mask = (bits: number[]) => stringifyAuthorityBitSet(new Set(bits))

const nodes: OrganizationNodeRecord[] = [
  { id: 1, nodeType: 'COMPANY', name: 'Root', path: [1], createdAt: timestamp },
  { id: 2, parentNodeId: 1, nodeType: 'TEAM', name: 'Middle', path: [1, 2], createdAt: timestamp },
  { id: 3, parentNodeId: 2, nodeType: 'PROJECT', name: 'Leaf', path: [1, 2, 3], createdAt: timestamp },
]

const users: UserRecord[] = [
  { userId: 'U-MIDDLE', email: 'middle@example.com', name: 'Middle User', createdAt: timestamp },
  { userId: 'U-DIRECT', email: 'direct@example.com', name: 'Direct User', createdAt: timestamp },
  { userId: 'U-SORT-A', email: 'sort-a@example.com', name: 'User A', createdAt: timestamp },
  { userId: 'U-SORT-B', email: 'sort-b@example.com', name: 'User B', createdAt: timestamp },
  { userId: 'U-SORT-C', email: 'sort-c@example.com', name: 'User C', createdAt: timestamp },
]

const inheritedAuthorities: AuthorityRecord[] = [
  { id: 10, nodeId: 1, roleName: 'ADMIN', authority: mask([0, 14, 15]), isTopRole: true },
  { id: 11, nodeId: 2, roleName: 'MEMBER', authority: mask([0, 4, 8]) },
  { id: 13, nodeId: 3, roleName: 'VIEWER', authority: mask([0]) },
]

function assignment(
  id: number,
  userId: string,
  nodeId: number,
  roleId: number,
  isDeleted = false,
): RoleAssignmentRecord {
  return {
    id,
    userId,
    nodeId,
    roleId,
    roleName: '',
    createdAt: timestamp,
    ...(isDeleted ? { isDeleted: true } : {}),
  }
}

test('the nearest ancestor role wins without a direct assignment', () => {
  const result = analyzeWorkspaceMembers({
    rootNode: nodes[2],
    nodes,
    users,
    authorities: inheritedAuthorities,
    roles: [
      assignment(1, 'U-MIDDLE', 1, 10),
      assignment(2, 'U-MIDDLE', 2, 11),
    ],
  })

  assert.equal(result.all.length, 1)
  assert.equal(result.all[0]?.effectiveRoleId, 11)
  assert.equal(result.all[0]?.effectiveRoleName, 'MEMBER')
  assert.equal(result.all[0]?.inheritedRoleName, 'MEMBER')
  assert.equal(result.all[0]?.sourceNodeName, 'Middle')
  assert.equal(result.all[0]?.isDirect, false)
  assert.equal(result.direct.length, 0)
  assert.equal(result.inherited.length, 1)
  assert.equal(result.overridden.length, 0)
})

test('a different direct role overrides an inherited role', () => {
  const result = analyzeWorkspaceMembers({
    rootNode: nodes[2],
    nodes,
    users,
    authorities: inheritedAuthorities,
    roles: [
      assignment(1, 'U-DIRECT', 1, 10),
      assignment(2, 'U-DIRECT', 3, 13),
    ],
  })

  assert.equal(result.all.length, 1)
  assert.equal(result.all[0]?.effectiveRoleId, 13)
  assert.equal(result.all[0]?.effectiveRoleName, 'VIEWER')
  assert.equal(result.all[0]?.directRoleName, 'VIEWER')
  assert.equal(result.all[0]?.inheritedRoleName, 'ADMIN')
  assert.equal(result.all[0]?.sourceNodeName, 'Leaf')
  assert.equal(result.all[0]?.isOverridden, true)
  assert.match(result.all[0]?.overrideReason ?? '', /Root.*ADMIN.*Leaf.*VIEWER/)
  assert.equal(result.direct.length, 1)
  assert.equal(result.inherited.length, 0)
  assert.equal(result.overridden.length, 1)
})

test('deleted assignments are excluded from direct and inherited members', () => {
  const result = analyzeWorkspaceMembers({
    rootNode: nodes[2],
    nodes,
    users,
    authorities: inheritedAuthorities,
    roles: [
      assignment(1, 'U-MIDDLE', 1, 10, true),
      assignment(2, 'U-DIRECT', 3, 13, true),
    ],
  })

  assert.deepEqual(result, { all: [], direct: [], inherited: [], overridden: [] })
})

test('members are sorted by top role, authority priority, then name', () => {
  const authorities: AuthorityRecord[] = [
    { id: 20, nodeId: 3, roleName: 'VIEWER', authority: mask([0]) },
    { id: 21, nodeId: 3, roleName: 'MANAGER', authority: mask([0, 14]) },
    { id: 22, nodeId: 3, roleName: 'ADMIN', authority: mask([0, 15]), isTopRole: true },
  ]
  const result = analyzeWorkspaceMembers({
    rootNode: nodes[2],
    nodes,
    users,
    authorities,
    roles: [
      assignment(1, 'U-SORT-A', 3, 20),
      assignment(2, 'U-SORT-B', 3, 21),
      assignment(3, 'U-SORT-C', 3, 22),
    ],
  })

  assert.deepEqual(result.all.map((member) => member.userId), ['U-SORT-C', 'U-SORT-B', 'U-SORT-A'])
  assert.deepEqual(result.direct.map((member) => member.userId), ['U-SORT-C', 'U-SORT-B', 'U-SORT-A'])
})

test('role priority scores are cached per bitmask map', () => {
  class CountingRoleMap extends Map<RoleName, string> {
    getCount = 0

    override get(key: RoleName): string | undefined {
      this.getCount += 1
      return super.get(key)
    }
  }

  const bitmaskMap = new CountingRoleMap([['10', mask([0, 14, 15])]])
  const first = getRolePriorityScore('10', bitmaskMap)
  const second = getRolePriorityScore('10', bitmaskMap)

  assert.equal(second, first)
  assert.equal(bitmaskMap.getCount, 1)
})

test('a missing root node returns empty member groups', () => {
  assert.deepEqual(
    analyzeWorkspaceMembers({ rootNode: null, nodes, users, authorities: inheritedAuthorities }),
    { all: [], direct: [], inherited: [], overridden: [] },
  )
})
