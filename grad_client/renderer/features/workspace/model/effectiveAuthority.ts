import {
  AUTHORITY_DENY_BIT,
  parseAuthorityBitSet,
} from './authorityDefinitions.js'
import type {
  RoleAssignmentRecord,
  WorkspaceSnapshot,
  WorkItemRecord,
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

    // 해당 노드(또는 기본 프리셋)의 권한 비트마스크 찾기
    const matchingAuth = snapshot.authorities?.find(
      (a) => a.nodeId === roleRecord.nodeId && a.id === roleRecord.roleId,
    )

    const mask = matchingAuth?.authority
    if (!mask) return

    const bits = parseAuthorityBitSet(mask)
    bits.forEach((bit) => combinedBitSet.add(bit))
  })

  // 4단계: DENY 비트 확인
  if (combinedBitSet.has(AUTHORITY_DENY_BIT)) {
    return new Set()
  }

  return combinedBitSet
}

/**
 * 해당 노드에 '직접' 부여된 역할만으로 계산한 권한 비트 집합.
 * 서버의 get_direct_authority 와 동일하게 조상 노드로 상속하지 않는다.
 * 역할 부여/변경/회수와 역할 정의 변경은 이 직속 권한만 인정한다.
 */
export type DirectAuthoritySource = Pick<WorkspaceSnapshot, 'roles' | 'authorities'>

export function getDirectAuthorityBitSet(
  userId: string,
  nodeId: number,
  snapshot: DirectAuthoritySource,
): Set<number> {
  const directRoles = snapshot.roles.filter(
    (r) =>
      !r.isDeleted &&
      r.nodeId === nodeId &&
      (r.userId === userId || r.userId.toLowerCase() === userId.toLowerCase()),
  )

  if (directRoles.length === 0) {
    return new Set()
  }

  const combinedBitSet = new Set<number>()

  directRoles.forEach((roleRecord) => {
    const matchingAuth = snapshot.authorities?.find(
      (a) => a.nodeId === roleRecord.nodeId && a.id === roleRecord.roleId,
    )

    const mask = matchingAuth?.authority
    if (!mask) return

    parseAuthorityBitSet(mask).forEach((bit) => combinedBitSet.add(bit))
  })

  // DENY 비트가 켜져 있으면 권한 없음으로 취급한다.
  if (combinedBitSet.has(AUTHORITY_DENY_BIT)) {
    return new Set()
  }

  return combinedBitSet
}

/** 특정 유저가 해당 노드에 '직속'으로 주어진 권한 비트를 가졌는지 검사 */
export function hasDirectAuthorityBit(
  userId: string,
  nodeId: number,
  bit: number,
  snapshot: DirectAuthoritySource,
): boolean {
  return getDirectAuthorityBitSet(userId, nodeId, snapshot).has(bit)
}

/** 사용자 역할 추가/변경/회수에 필요한 직속 권한 (NODE_ADD_ROLE, Bit 14) */
export function canManageNodeRoles(
  userId: string,
  nodeId: number,
  snapshot: DirectAuthoritySource,
): boolean {
  return hasDirectAuthorityBit(userId, nodeId, 14, snapshot)
}

/** 역할 정의(권한/이름) 변경에 필요한 직속 권한 (ROLE_CHANGE, Bit 15) */
export function canChangeRoleDefinitions(
  userId: string,
  nodeId: number,
  snapshot: DirectAuthoritySource,
): boolean {
  return hasDirectAuthorityBit(userId, nodeId, 15, snapshot)
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
 * 노드 정보 변경 권한(NODE_INFO_CHANGE, Bit 12) 보유 여부 검사.
 * 워크스페이스 삭제/복구도 이 권한을 사용한다.
 */
export function canChangeNodeInfo(
  userId: string,
  nodeId: number,
  snapshot: WorkspaceSnapshot,
): boolean {
  return hasEffectiveAuthorityBit(userId, nodeId, 12, snapshot)
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

/** 정기 일정 조회 권한 (SCHEDULE_VIEW, Bit 18) */
export function canViewSchedule(
  userId: string,
  nodeId: number,
  snapshot: WorkspaceSnapshot,
): boolean {
  return hasEffectiveAuthorityBit(userId, nodeId, 18, snapshot)
}

/** 정기 일정 생성/편집 권한 (SCHEDULE_CHANGE, Bit 19) */
export function canChangeSchedule(
  userId: string,
  nodeId: number,
  snapshot: WorkspaceSnapshot,
): boolean {
  return hasEffectiveAuthorityBit(userId, nodeId, 19, snapshot)
}

/** 공개 업무 조회 권한 (WI_PUBLIC_VIEW, Bit 4) */
export function canViewWorkItems(
  userId: string,
  nodeId: number,
  snapshot: WorkspaceSnapshot,
): boolean {
  return hasEffectiveAuthorityBit(userId, nodeId, 4, snapshot)
}

/** 파일 조회 권한 (FILE_VIEW, Bit 16) */
export function canViewFiles(
  userId: string,
  nodeId: number,
  snapshot: WorkspaceSnapshot,
): boolean {
  return hasEffectiveAuthorityBit(userId, nodeId, 16, snapshot)
}

/** 활동 이력 조회 권한 (HISTORY_PERSONAL_VIEW 20 또는 HISTORY_ALL_VIEW 21) */
export function canViewHistory(
  userId: string,
  nodeId: number,
  snapshot: WorkspaceSnapshot,
): boolean {
  return (
    hasEffectiveAuthorityBit(userId, nodeId, 20, snapshot) ||
    hasEffectiveAuthorityBit(userId, nodeId, 21, snapshot)
  )
}

/** 멤버/역할 목록 조회 권한 (NODE_MEMBERS_VIEW, Bit 1) */
export function canViewMembers(
  userId: string,
  nodeId: number,
  snapshot: WorkspaceSnapshot,
): boolean {
  return hasEffectiveAuthorityBit(userId, nodeId, 1, snapshot)
}

/** 상위 조상 노드 트리 조회 권한 (NODE_PARENT_VIEW, Bit 3) */
export function canViewParentNode(
  userId: string,
  nodeId: number,
  snapshot: WorkspaceSnapshot,
): boolean {
  return hasEffectiveAuthorityBit(userId, nodeId, 3, snapshot)
}

/** 하위 자식 노드 탐색/조회 권한 (NODE_SUB_VIEW, Bit 2) */
export function canViewSubNodes(
  userId: string,
  nodeId: number,
  snapshot: WorkspaceSnapshot,
): boolean {
  return hasEffectiveAuthorityBit(userId, nodeId, 2, snapshot)
}

/** GitHub 저장소 조회 권한 (GITHUB_VIEW, Bit 22) */
export function canViewGithub(
  userId: string,
  nodeId: number,
  snapshot: WorkspaceSnapshot,
): boolean {
  return hasEffectiveAuthorityBit(userId, nodeId, 22, snapshot)
}

/**
 * 업무 신규 생성 가능 여부 (본인 업무 생성 WI_PERSONAL_CHANGE Bit 8 또는 타인 배정 WI_ASSIGN Bit 10)
 */
export function canCreateWorkItem(
  userId: string,
  nodeId: number,
  snapshot: WorkspaceSnapshot,
): boolean {
  return (
    hasEffectiveAuthorityBit(userId, nodeId, 8, snapshot) ||
    hasEffectiveAuthorityBit(userId, nodeId, 10, snapshot)
  )
}

/**
 * 업무 상세 내용 및 댓글 조회 가능 여부.
 * - 본인 업무인 경우: 기본 접근 가능 (WI_PUBLIC_VIEW Bit 4 또는 숨김 업무면 WI_HIDDEN_VIEW Bit 6)
 * - 다른 사용자의 업무인 경우: WI_OTHERS_DETAIL_VIEW(Bit 5) 권한 필요
 */
export function canViewWorkItemDetail(
  userId: string | null | undefined,
  item: Pick<WorkItemRecord, 'ownerNodeId' | 'ownerUserId'> & { hidden?: boolean },
  snapshot: WorkspaceSnapshot,
): boolean {
  if (!userId) return false
  const isOwner = item.ownerUserId === userId

  // 본인 업무이면 기본 공개(4)/숨김(6) 권한만으로 상세 조회 가능
  if (isOwner) {
    return item.hidden
      ? hasEffectiveAuthorityBit(userId, item.ownerNodeId, 6, snapshot)
      : hasEffectiveAuthorityBit(userId, item.ownerNodeId, 4, snapshot)
  }

  // 타인의 업무인 경우: WI_OTHERS_DETAIL_VIEW (Bit 5) 필수
  return hasEffectiveAuthorityBit(userId, item.ownerNodeId, 5, snapshot)
}
