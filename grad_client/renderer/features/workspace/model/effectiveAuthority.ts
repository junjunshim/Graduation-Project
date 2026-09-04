import {
  DEFAULT_ROLE_AUTHORITIES,
  parseAuthorityBitSet,
} from './authorityDefinitions'
import type {
  RoleAssignmentRecord,
  StandardRoleName,
  WorkspaceSnapshot,
} from './types'

export function getEffectiveAuthorityBitSet(
  userId: string,
  nodeId: number,
  snapshot: WorkspaceSnapshot,
): Set<number> {
  const node = snapshot.nodes.find((n) => n.id === nodeId)
  if (!node) {
    return new Set()
  }

  // 1단계: 현재 노드(nodeId)에 직접 할당된 역할들 확인
  const directRoles = snapshot.roles.filter(
    (r) => !r.isDeleted && r.nodeId === nodeId && (r.userId === userId || r.userId.toLowerCase() === userId.toLowerCase()),
  )

  let effectiveRoles: RoleAssignmentRecord[] = directRoles

  // 2단계: 직접 할당이 없으면 path(부모 노드 역순) 탐색
  if (effectiveRoles.length === 0 && node.path && Array.isArray(node.path)) {
    const reversedPath = [...node.path].reverse()
    for (const ancestorId of reversedPath) {
      if (ancestorId === nodeId) continue
      const ancestorRoles = snapshot.roles.filter(
        (r) => !r.isDeleted && r.nodeId === ancestorId && (r.userId === userId || r.userId.toLowerCase() === userId.toLowerCase()),
      )
      if (ancestorRoles.length > 0) {
        effectiveRoles = ancestorRoles
        break
      }
    }
  }

  if (effectiveRoles.length === 0) {
    return new Set()
  }

  // 3단계: 역할 비트마스크 합산 (BIT_OR)
  const combinedBitSet = new Set<number>()

  effectiveRoles.forEach((roleRecord) => {
    const roleName = roleRecord.roleName
    if (roleName === 'ADMIN') {
      const adminBits = parseAuthorityBitSet(DEFAULT_ROLE_AUTHORITIES.ADMIN)
      adminBits.forEach((bit) => combinedBitSet.add(bit))
      return
    }

    // 해당 노드(또는 기본 프리셋)의 권한 비트마스크 찾기
    const matchingAuth = snapshot.authorities?.find(
      (a) => a.nodeId === roleRecord.nodeId && a.roleName === roleName,
    )

    let mask = matchingAuth?.authority
    if (!mask) {
      mask =
        roleName in DEFAULT_ROLE_AUTHORITIES
          ? DEFAULT_ROLE_AUTHORITIES[roleName as StandardRoleName]
          : DEFAULT_ROLE_AUTHORITIES.MEMBER
    }

    const bits = parseAuthorityBitSet(mask)
    bits.forEach((bit) => combinedBitSet.add(bit))
  })

  // 4단계: DENY 비트(bit 23) 확인
  if (combinedBitSet.has(23)) {
    return new Set()
  }

  return combinedBitSet
}

/**
 * 특정 유저가 특정 노드에 대해 주어진 권한 비트(bit)를 가지고 있는지 검사
 */
export function hasEffectiveAuthorityBit(
  userId: string,
  nodeId: number,
  bit: number,
  snapshot: WorkspaceSnapshot,
): boolean {
  const bitSet = getEffectiveAuthorityBitSet(userId, nodeId, snapshot)
  return bitSet.has(bit)
}

/**
 * 하위 노드 생성 권한(NODE_SUB_CREATE, Bit 13) 보유 여부 검사
 */
export function canCreateSubNode(
  userId: string,
  nodeId: number,
  snapshot: WorkspaceSnapshot,
): boolean {
  return hasEffectiveAuthorityBit(userId, nodeId, 13, snapshot)
}

/**
 * 하위 노드 소유자 지정 가능 자격(WI_PERSONAL_CHANGE, Bit 8) 보유 여부 검사
 */
export function isEligibleAsSubNodeOwner(
  userId: string,
  parentNodeId: number,
  snapshot: WorkspaceSnapshot,
): boolean {
  return hasEffectiveAuthorityBit(userId, parentNodeId, 8, snapshot)
}
