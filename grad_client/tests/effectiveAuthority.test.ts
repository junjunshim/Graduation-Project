import assert from 'node:assert/strict'
import test from 'node:test'
import { stringifyAuthorityBitSet } from '../renderer/features/workspace/model/authorityDefinitions.js'
import {
  canChangeRoleDefinitions,
  canManageNodeRoles,
  getDirectAuthorityBitSet,
  hasDirectAuthorityBit,
} from '../renderer/features/workspace/model/effectiveAuthority.js'
import type { AuthorityRecord, RoleAssignmentRecord } from '../renderer/features/workspace/model/types.js'

const mask = (bits: number[]) => stringifyAuthorityBitSet(new Set(bits))

// 노드 4(직속) / 노드 1(상위 조상) 구조
const authorities: AuthorityRecord[] = [
  { id: 10, nodeId: 4, roleName: 'MANAGER', authority: mask([0, 1, 4, 8, 14]) },
  { id: 11, nodeId: 4, roleName: 'VIEWER', authority: mask([0, 4]) },
  { id: 12, nodeId: 1, roleName: 'ADMIN', authority: mask([0, 1, 14, 15]), isTopRole: true },
]

const assignment = (
  id: number,
  userId: string,
  nodeId: number,
  roleId: number,
): RoleAssignmentRecord => ({
  id,
  userId,
  nodeId,
  roleId,
  roleName: '',
  createdAt: '2026-09-20T00:00:00Z',
})

test('직속 할당이 없으면 상속된 역할은 직속 권한으로 인정되지 않는다', () => {
  // U-13 은 노드 4에 직접 할당이 없고, 상위 노드 1에만 역할이 있다.
  const roles = [assignment(1, 'U-13', 1, 12)]
  const snapshot = { roles, authorities }

  assert.equal(hasDirectAuthorityBit('U-13', 4, 14, snapshot), false)
  assert.equal(canManageNodeRoles('U-13', 4, snapshot), false)
  assert.equal(getDirectAuthorityBitSet('U-13', 4, snapshot).size, 0)

  // 자기 노드에서는 직속으로 인정된다.
  assert.equal(canManageNodeRoles('U-13', 1, snapshot), true)
})

test('직속 역할의 비트만 합산한다 (멤버 관리 14 / 역할 정의 15)', () => {
  const snapshot = {
    roles: [assignment(1, 'U-12', 4, 10), assignment(2, 'U-14', 4, 12)],
    authorities,
  }

  assert.equal(canManageNodeRoles('U-12', 4, snapshot), true)
  assert.equal(canChangeRoleDefinitions('U-12', 4, snapshot), false)

  // U-14 는 노드 4에 직접 배정되었지만 노드 1의 정의를 참조할 수 없으므로 권한이 없다.
  assert.equal(canManageNodeRoles('U-14', 4, snapshot), false)
})

test('DENY 비트(23)가 켜져 있으면 직속 권한은 모두 무효다', () => {
  const denyAuthority: AuthorityRecord = {
    id: 13,
    nodeId: 4,
    roleName: 'DENIED',
    authority: mask([0, 14, 23]),
  }
  const snapshot = {
    roles: [assignment(1, 'U-15', 4, 13)],
    authorities: [...authorities, denyAuthority],
  }

  assert.equal(getDirectAuthorityBitSet('U-15', 4, snapshot).size, 0)
  assert.equal(canManageNodeRoles('U-15', 4, snapshot), false)
})

test('삭제된 역할 할당은 직속 권한 계산에서 제외한다', () => {
  const roles = [{ ...assignment(1, 'U-12', 4, 10), isDeleted: true }]
  const snapshot = { roles, authorities }

  assert.equal(canManageNodeRoles('U-12', 4, snapshot), false)
})