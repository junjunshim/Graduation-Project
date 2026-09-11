import { resolveRoleAssignments } from './roleDefinitions'
import {
  AUTHORITY_BITS,
  parseAuthorityBitSet,
} from './authorityDefinitions'
import type {
  AuthorityRecord,
  OrganizationNodeRecord,
  RoleAssignmentRecord,
  RoleMember,
  RoleName,
  UserRecord,
} from './types'

export type WorkspaceMemberDetail = {
  effectiveRoleId?: number
  isTopRole?: boolean
  userId: string
  name: string
  email: string
  effectiveRoleName: RoleName
  directRoleName?: RoleName
  inheritedRoleName?: RoleName
  isDirect: boolean
  isOverridden: boolean
  sourceNodeName?: string
  overrideReason?: string
  assignedNodeId: number
}


export function getRolePriorityScore(
  role: string,
  roleBitmaskMap: Map<RoleName, string>,
): number {
  const mask = roleBitmaskMap.get(role) ?? '000000000000000000000000'
  const bitSet = parseAuthorityBitSet(mask)

  let score = 0
  if (bitSet.has(15)) score += 10000 // ROLE_CHANGE
  if (bitSet.has(14)) score += 5000 // ROLE_ASSIGN
  if (bitSet.has(13)) score += 3000 // NODE_DELETE
  if (bitSet.has(12)) score += 2000 // NODE_UPDATE
  if (bitSet.has(11)) score += 1000 // NODE_CREATE
  if (bitSet.has(21)) score += 800 // HISTORY_ALL_VIEW
  if (bitSet.has(9)) score += 500 // WI_OTHERS_CHANGE
  if (bitSet.has(10)) score += 300 // WI_ASSIGN
  if (bitSet.has(17)) score += 200 // FILE_CHANGE
  if (bitSet.has(6)) score += 150 // WI_HIDDEN_VIEW

  const activeCount = AUTHORITY_BITS.filter((b) => b.bit !== 23 && bitSet.has(b.bit)).length
  score += activeCount * 10
  return score
}

export function buildRoleBitmaskMap(
  authorities: AuthorityRecord[] = [],
  rootNode?: OrganizationNodeRecord | null,
): Map<RoleName, string> {
  const map = new Map<RoleName, string>()
  const nodeAuthorities = authorities.filter((a) => !rootNode || a.nodeId === rootNode.id)

  nodeAuthorities.forEach((a) => map.set(String(a.id), a.authority))

  return map
}

export function analyzeWorkspaceMembers({
  rootNode,
  nodes = [],
  roles = [],
  users = [],
  authorities = [],
  allRoleMembers = [],
}: {
  rootNode?: OrganizationNodeRecord | null
  nodes?: OrganizationNodeRecord[]
  roles?: RoleAssignmentRecord[]
  users?: UserRecord[]
  authorities?: AuthorityRecord[]
  allRoleMembers?: RoleMember[]
}): {
  all: WorkspaceMemberDetail[]
  direct: WorkspaceMemberDetail[]
  inherited: WorkspaceMemberDetail[]
  overridden: WorkspaceMemberDetail[]
} {
  if (!rootNode) {
    return { all: [], direct: [], inherited: [], overridden: [] }
  }

  roles = resolveRoleAssignments(roles, authorities)
  const roleBitmaskMap = buildRoleBitmaskMap(authorities)
  const getRolePriority = (role: string) => getRolePriorityScore(role, roleBitmaskMap)

  const nodesById = new Map(nodes.map((n) => [n.id, n]))
  const usersById = new Map(users.map((u) => [u.userId, u]))

  // 1. 현재 노드에 직접 할당된 역할들
  const directRoleMap = new Map<string, RoleAssignmentRecord>()
  roles
    .filter((r) => r.nodeId === rootNode.id && !r.isDeleted)
    .forEach((r) => directRoleMap.set(r.userId, r))

  // 2. 상위 조상 노드 ID 집합 식별 (path 컬럼 활용)
  const ancestorNodeIdSet = new Set<number>()
  if (rootNode.path && Array.isArray(rootNode.path)) {
    rootNode.path.forEach((id) => {
      if (id !== rootNode.id) ancestorNodeIdSet.add(id)
    })
  }

  // 상위 조상 노드에 배정된 역할들을 userId별로 사전 그룹화 (O(Roles) 1회 인덱싱)
  const ancestorRolesByUserId = new Map<string, RoleAssignmentRecord[]>()
  roles.forEach((r) => {
    if (!r.isDeleted && ancestorNodeIdSet.has(r.nodeId)) {
      const userRoles = ancestorRolesByUserId.get(r.userId) ?? []
      userRoles.push(r)
      ancestorRolesByUserId.set(r.userId, userRoles)
    }
  })

  // 3. 현재 노드의 대상 사용자: 현재 노드 직속 역할자 + 상위 조상 역할자만 검사 (500명 무의미한 순회 방지)
  const candidateUserIds = new Set<string>()
  directRoleMap.forEach((_, userId) => candidateUserIds.add(userId))
  ancestorRolesByUserId.forEach((_, userId) => candidateUserIds.add(userId))

  const all: WorkspaceMemberDetail[] = []

  candidateUserIds.forEach((userId) => {
    const user = usersById.get(userId)
    const directRole = directRoleMap.get(userId)
    const isDirect = Boolean(directRole)

    // 상위 조상 노드들에 부여된 이 사용자의 역할 조회 (Map에서 O(1) 즉시 가져옴)
    const ancestorRoles = ancestorRolesByUserId.get(userId) ?? []

    let isOverridden = false
    let overrideReason = ''
    let effectiveRole: RoleName = directRole?.roleName ?? '역할 정보 없음'
    let sourceNodeName = rootNode.name

    // 상위 조상 노드로부터 물려받은 최고 역할 계산 (가까운 노드 우선)
    const inheritedRole =
      ancestorRoles.length > 0
        ? ancestorRoles.reduce((prev, curr) =>
            rootNode.path.indexOf(curr.nodeId) > rootNode.path.indexOf(prev.nodeId) ? curr : prev,
          )
        : null

    if (inheritedRole) {
      const ancestorNode = nodesById.get(inheritedRole.nodeId)
      const ancestorNodeName = ancestorNode?.name || '상위 노드'

      if (directRole && directRole.roleId !== inheritedRole.roleId) {
        // 상위 역할이 있는데 현재 노드에서 다르게 직접 재정의된 경우 => 오버라이드
        isOverridden = true
        overrideReason = `${ancestorNodeName} (${inheritedRole.roleName}) ➔ ${rootNode.name} 직속 재정의 (${directRole.roleName})`
        effectiveRole = directRole.roleName
        sourceNodeName = rootNode.name
      } else if (!directRole) {
        // 직속 할당 없이 상위에서 상속받은 경우
        effectiveRole = inheritedRole.roleName
        sourceNodeName = ancestorNodeName
      }
    }

    if (!isDirect && !inheritedRole) {
      return
    }

    const name = user?.name || allRoleMembers.find((m) => m.userId === userId)?.name || userId
    const email = user?.email || allRoleMembers.find((m) => m.userId === userId)?.email || ''

    all.push({
      userId,
      name,
      email,
      effectiveRoleName: effectiveRole,
      effectiveRoleId: (directRole ?? inheritedRole)?.roleId,
      isTopRole: (directRole ?? inheritedRole)?.isTopRole,
      directRoleName: directRole?.roleName,
      inheritedRoleName: inheritedRole?.roleName,
      isDirect,
      isOverridden,
      sourceNodeName,
      overrideReason,
      assignedNodeId: rootNode.id,
    })
  })

  // 기본 정렬: 역할 우선순위 -> 이름순
  all.sort((a, b) => {
    const priorityDiff = Number(Boolean(b.isTopRole)) - Number(Boolean(a.isTopRole)) || getRolePriority(String(b.effectiveRoleId)) - getRolePriority(String(a.effectiveRoleId))
    if (priorityDiff !== 0) return priorityDiff
    return a.name.localeCompare(b.name, 'ko')
  })

  const direct = all.filter((m) => m.isDirect)
  const inherited = all.filter((m) => !m.isDirect && Boolean(m.inheritedRoleName))
  const overridden = all.filter((m) => m.isOverridden)

  return { all, direct, inherited, overridden }
}

export type WorkspaceMemberSummary = {
  totalCount: number
  directCount: number
  inheritedCount: number
  overriddenCount: number
  displayValue: string
  description: string
}

/**
 * 프로젝트 전역에서 워크스페이스 팀원 지표(KPI 및 표시 텍스트)를 일관되게 제공하는 단일 표준 함수
 */
export function getWorkspaceMemberSummary({
  rootNode,
  nodes = [],
  roles = [],
  users = [],
  authorities = [],
  allRoleMembers = [],
}: {
  rootNode?: OrganizationNodeRecord | null
  nodes?: OrganizationNodeRecord[]
  roles?: RoleAssignmentRecord[]
  users?: UserRecord[]
  authorities?: AuthorityRecord[]
  allRoleMembers?: RoleMember[]
}): WorkspaceMemberSummary {
  const analysis = analyzeWorkspaceMembers({
    rootNode,
    nodes,
    roles,
    users,
    authorities,
    allRoleMembers,
  })

  const totalCount = analysis.all.length
  const directCount = analysis.direct.length
  const inheritedCount = analysis.inherited.length
  const overriddenCount = analysis.overridden.length
  const isRoot = !rootNode?.parentNodeId

  const displayValue = isRoot ? String(totalCount) : `${directCount} / ${totalCount}`
  const description = isRoot
    ? `직속 ${directCount} · 오버라이드 ${overriddenCount}`
    : `직속 ${directCount} · 상속 ${inheritedCount}${overriddenCount > 0 ? ` · 오버라이드 ${overriddenCount}` : ''}`

  return {
    totalCount,
    directCount,
    inheritedCount,
    overriddenCount,
    displayValue,
    description,
  }
}
