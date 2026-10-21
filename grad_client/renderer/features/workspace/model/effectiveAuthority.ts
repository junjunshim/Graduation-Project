import {
  AUTHORITY_DENY_BIT,
  parseAuthorityBitSet,
} from './authorityDefinitions.js'
import type {
  OrganizationNodeRecord,
  RoleAssignmentRecord,
  WorkspaceSnapshot,
  WorkItemRecord,
} from './types'

export type DirectAuthoritySource = Pick<WorkspaceSnapshot, 'roles' | 'authorities'>

type AuthoritySourceIndex = {
  rolesByUserNode: Map<string, RoleAssignmentRecord[]>
  authorityBitsByDefinition: Map<string, Set<number>>
}

const MAX_AUTHORITY_CACHE_ENTRIES = 512
const effectiveAuthorityBitSetCache = new WeakMap<WorkspaceSnapshot, Map<string, Set<number>>>()
const directAuthorityBitSetCache = new WeakMap<DirectAuthoritySource, Map<string, Set<number>>>()
const authoritySourceIndexCache = new WeakMap<DirectAuthoritySource, AuthoritySourceIndex>()
const nodeIndexCache = new WeakMap<WorkspaceSnapshot, Map<number, OrganizationNodeRecord>>()
const EMPTY_ROLES: RoleAssignmentRecord[] = []

function getAuthorityCacheKey(userId: string, nodeId: number) {
  return `${userId.toLowerCase()}\u0000${nodeId}`
}

function getAuthorityDefinitionKey(nodeId: number, roleId: number | undefined) {
  return roleId === undefined ? '' : `${nodeId}\u0000${roleId}`
}

function getNodeIndex(snapshot: WorkspaceSnapshot) {
  const cached = nodeIndexCache.get(snapshot)
  if (cached) {
    return cached
  }

  const nodeById = new Map<number, OrganizationNodeRecord>()
  snapshot.nodes.forEach((node) => {
    if (!nodeById.has(node.id)) {
      nodeById.set(node.id, node)
    }
  })
  nodeIndexCache.set(snapshot, nodeById)
  return nodeById
}

function getAuthoritySourceIndex(source: DirectAuthoritySource) {
  const cached = authoritySourceIndexCache.get(source)
  if (cached) {
    return cached
  }

  const rolesByUserNode = new Map<string, RoleAssignmentRecord[]>()
  source.roles.forEach((role) => {
    if (role.isDeleted) {
      return
    }

    const key = getAuthorityCacheKey(role.userId, role.nodeId)
    const roles = rolesByUserNode.get(key)

    if (roles) {
      roles.push(role)
    } else {
      rolesByUserNode.set(key, [role])
    }
  })

  const authorityBitsByDefinition = new Map<string, Set<number>>()
  source.authorities?.forEach((authority) => {
    const key = getAuthorityDefinitionKey(authority.nodeId, authority.id)

    if (!authorityBitsByDefinition.has(key)) {
      authorityBitsByDefinition.set(key, parseAuthorityBitSet(authority.authority))
    }
  })

  const index = { rolesByUserNode, authorityBitsByDefinition }
  authoritySourceIndexCache.set(source, index)
  return index
}

function getRolesForUserNode(source: DirectAuthoritySource, userId: string, nodeId: number) {
  return (
    getAuthoritySourceIndex(source).rolesByUserNode.get(getAuthorityCacheKey(userId, nodeId)) ??
    EMPTY_ROLES
  )
}

function getAuthorityBitsForRole(
  source: DirectAuthoritySource,
  role: RoleAssignmentRecord,
): Set<number> | undefined {
  return getAuthoritySourceIndex(source).authorityBitsByDefinition.get(
    getAuthorityDefinitionKey(role.nodeId, role.roleId),
  )
}

function getCachedAuthorityBitSet<Source extends object>(
  cache: WeakMap<Source, Map<string, Set<number>>>,
  source: Source,
  cacheKey: string,
  calculate: () => Set<number>,
) {
  let sourceCache = cache.get(source)
  const cached = sourceCache?.get(cacheKey)

  if (cached) {
    return cached
  }

  const bitSet = calculate()
  sourceCache ??= new Map<string, Set<number>>()

  if (sourceCache.size >= MAX_AUTHORITY_CACHE_ENTRIES) {
    const oldestKey = sourceCache.keys().next()
    if (!oldestKey.done) {
      sourceCache.delete(oldestKey.value)
    }
  }

  sourceCache.set(cacheKey, bitSet)
  cache.set(source, sourceCache)
  return bitSet
}

function calculateEffectiveAuthorityBitSet(
  userId: string,
  nodeId: number,
  snapshot: WorkspaceSnapshot,
): Set<number> {
  const node = getNodeIndex(snapshot).get(nodeId)
  if (!node) {
    return new Set()
  }

  // 1단계: 현재 노드(nodeId)에 직접 할당된 역할들 확인
  let effectiveRoles = getRolesForUserNode(snapshot, userId, nodeId)

  // 2단계: 직접 할당이 없으면 path(부모 노드 역순) 탐색
  if (effectiveRoles.length === 0 && node.path && Array.isArray(node.path)) {
    for (let index = node.path.length - 1; index >= 0; index -= 1) {
      const ancestorId = node.path[index]
      if (ancestorId === undefined || ancestorId === nodeId) continue
      const ancestorRoles = getRolesForUserNode(snapshot, userId, ancestorId)
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
    getAuthorityBitsForRole(snapshot, roleRecord)?.forEach((bit) => combinedBitSet.add(bit))
  })

  // 4단계: DENY 비트 확인
  if (combinedBitSet.has(AUTHORITY_DENY_BIT)) {
    return new Set()
  }

  return combinedBitSet
}

function resolveEffectiveAuthorityBitSet(
  userId: string,
  nodeId: number,
  snapshot: WorkspaceSnapshot,
): Set<number> {
  return getCachedAuthorityBitSet(
    effectiveAuthorityBitSetCache,
    snapshot,
    getAuthorityCacheKey(userId, nodeId),
    () => calculateEffectiveAuthorityBitSet(userId, nodeId, snapshot),
  )
}

export function getEffectiveAuthorityBitSet(
  userId: string,
  nodeId: number,
  snapshot: WorkspaceSnapshot,
): Set<number> {
  return new Set(resolveEffectiveAuthorityBitSet(userId, nodeId, snapshot))
}

/**
 * 해당 노드에 '직접' 부여된 역할만으로 계산한 권한 비트 집합.
 * 서버의 get_direct_authority 와 동일하게 조상 노드로 상속하지 않는다.
 * 역할 부여/변경/회수와 역할 정의 변경은 이 직속 권한만 인정한다.
 */
function calculateDirectAuthorityBitSet(
  userId: string,
  nodeId: number,
  snapshot: DirectAuthoritySource,
): Set<number> {
  const directRoles = getRolesForUserNode(snapshot, userId, nodeId)

  if (directRoles.length === 0) {
    return new Set()
  }

  const combinedBitSet = new Set<number>()

  directRoles.forEach((roleRecord) => {
    getAuthorityBitsForRole(snapshot, roleRecord)?.forEach((bit) => combinedBitSet.add(bit))
  })

  // DENY 비트가 켜져 있으면 권한 없음으로 취급한다.
  if (combinedBitSet.has(AUTHORITY_DENY_BIT)) {
    return new Set()
  }

  return combinedBitSet
}

function resolveDirectAuthorityBitSet(
  userId: string,
  nodeId: number,
  snapshot: DirectAuthoritySource,
): Set<number> {
  return getCachedAuthorityBitSet(
    directAuthorityBitSetCache,
    snapshot,
    getAuthorityCacheKey(userId, nodeId),
    () => calculateDirectAuthorityBitSet(userId, nodeId, snapshot),
  )
}

export function getDirectAuthorityBitSet(
  userId: string,
  nodeId: number,
  snapshot: DirectAuthoritySource,
): Set<number> {
  return new Set(resolveDirectAuthorityBitSet(userId, nodeId, snapshot))
}

/** 특정 유저가 해당 노드에 '직속'으로 주어진 권한 비트를 가졌는지 검사 */
export function hasDirectAuthorityBit(
  userId: string,
  nodeId: number,
  bit: number,
  snapshot: DirectAuthoritySource,
): boolean {
  return resolveDirectAuthorityBitSet(userId, nodeId, snapshot).has(bit)
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
  const bitSet = resolveEffectiveAuthorityBitSet(userId, nodeId, snapshot)
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
