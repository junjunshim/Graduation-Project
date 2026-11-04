import { resolveRoleAssignments } from '../model/roleDefinitions.js'
import { AUTHORITY_DENY_BIT, parseAuthorityBitSet } from '../model/authorityDefinitions.js'
import type {
  AuthorityRecord,
  OrganizationNodeRecord,
  RoleAssignmentRecord,
  RoleMember,
  SelectedNodeDetail,
  UserRecord,
  WorkspaceSnapshot,
} from '../model/types.js'
import { getAccessibleNodeIdsForUser, getNodePathLabel, getOrgSnapshot } from '../data/orgService.js'
import { sortWorkspaceNodes, sortWorkspaceWorkItems } from '../model/sorters.js'

type SelectedNodeDetailOptions = {
  requireDirectManagementRole?: boolean
}

type RoleMemberWithNodeId = RoleMember & { nodeId: number }

const selectedNodeDetailCache = new WeakMap<
  WorkspaceSnapshot,
  Map<string, SelectedNodeDetail | null>
>()
const resolvedRolesCache = new WeakMap<WorkspaceSnapshot, RoleAssignmentRecord[]>()
const roleMembersCache = new WeakMap<WorkspaceSnapshot, RoleMemberWithNodeId[]>()
const userIndexCache = new WeakMap<WorkspaceSnapshot, Map<string, UserRecord>>()
const authorityIndexCache = new WeakMap<WorkspaceSnapshot, Map<string, AuthorityRecord>>()
const MAX_SELECTED_NODE_DETAIL_ENTRIES = 64

function getSelectedNodeDetailCacheKey(
  nodeId: number,
  userId: string | undefined,
  options: SelectedNodeDetailOptions,
) {
  return [userId ?? '', nodeId, options.requireDirectManagementRole === true ? '1' : '0'].join(
    '\u0000',
  )
}

function getResolvedRoles(snapshot: WorkspaceSnapshot) {
  const cached = resolvedRolesCache.get(snapshot)
  if (cached) {
    return cached
  }

  const roles = resolveRoleAssignments(snapshot.roles, snapshot.authorities ?? [])
  resolvedRolesCache.set(snapshot, roles)
  return roles
}

function getUserIndex(snapshot: WorkspaceSnapshot) {
  const cached = userIndexCache.get(snapshot)
  if (cached) {
    return cached
  }

  const userById = new Map<string, UserRecord>()
  snapshot.users.forEach((user) => {
    if (!userById.has(user.userId)) {
      userById.set(user.userId, user)
    }
  })
  userIndexCache.set(snapshot, userById)
  return userById
}

function getAuthorityIndex(snapshot: WorkspaceSnapshot) {
  const cached = authorityIndexCache.get(snapshot)
  if (cached) {
    return cached
  }

  const authorityByDefinition = new Map<string, AuthorityRecord>()
  snapshot.authorities?.forEach((authority) => {
    const key = getAuthorityDefinitionKey(authority.nodeId, authority.id)
    if (!authorityByDefinition.has(key)) {
      authorityByDefinition.set(key, authority)
    }
  })
  authorityIndexCache.set(snapshot, authorityByDefinition)
  return authorityByDefinition
}

function getAuthorityDefinitionKey(nodeId: number, roleId: number | undefined) {
  return roleId === undefined ? '' : `${nodeId}\u0000${roleId}`
}

function getRoleMembers(snapshot: WorkspaceSnapshot) {
  const cached = roleMembersCache.get(snapshot)
  if (cached) {
    return cached
  }

  const userById = getUserIndex(snapshot)
  const members = getResolvedRoles(snapshot).map((role): RoleMemberWithNodeId => {
    const user = userById.get(role.userId)

    return {
      assignmentId: role.id,
      userId: role.userId,
      nodeId: role.nodeId,
      name: user?.name ?? role.userId,
      email: user?.email ?? '',
      roleName: role.roleName,
      roleId: role.roleId,
      isTopRole: role.isTopRole,
    }
  })
  roleMembersCache.set(snapshot, members)
  return members
}

function getInheritedManagers(
  node: OrganizationNodeRecord,
  roles: RoleMemberWithNodeId[],
  users: ReturnType<typeof getOrgSnapshot>['users'],
  canManageRole: (role: RoleMemberWithNodeId) => boolean,
) {
  const pathNodeIds = new Set(node.path)
  const inheritedIds = new Set<string>()

  roles.forEach((role) => {
    if (pathNodeIds.has(role.nodeId) && canManageRole(role)) {
      inheritedIds.add(role.userId)
    }
  })

  return users.filter((user) => inheritedIds.has(user.userId))
}

function toRoleMembers(roles: RoleMemberWithNodeId[], nodeId: number) {
  return roles
    .filter((role) => role.nodeId === nodeId)
    .map((role) => ({
      assignmentId: role.assignmentId,
      userId: role.userId,
      nodeId: role.nodeId,
      name: role.name,
      email: role.email,
      roleName: role.roleName,
      roleId: role.roleId,
      isTopRole: role.isTopRole,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'ko'))
}

function calculateSelectedNodeDetail(
  nodeId: number,
  snapshot: WorkspaceSnapshot,
  userId?: string,
  options: SelectedNodeDetailOptions = {},
): SelectedNodeDetail | null {
  const roles = getRoleMembers(snapshot)
  const authorityByDefinition = getAuthorityIndex(snapshot)
  const canManageRoleCache = new Map<string, boolean>()
  const canManageRole = (role: RoleMemberWithNodeId) => {
    const cacheKey = getAuthorityDefinitionKey(role.nodeId, role.roleId)

    if (!cacheKey) {
      return false
    }

    const cached = canManageRoleCache.get(cacheKey)
    if (cached !== undefined) {
      return cached
    }

    const definition = authorityByDefinition.get(cacheKey)

    if (!definition) {
      canManageRoleCache.set(cacheKey, false)
      return false
    }

    const bits = parseAuthorityBitSet(definition.authority)
    const canManage =
      !bits.has(AUTHORITY_DENY_BIT) && (definition.isTopRole === true || bits.has(15))
    canManageRoleCache.set(cacheKey, canManage)
    return canManage
  }
  const accessibleNodeIds = userId
    ? getAccessibleNodeIdsForUser(userId, snapshot)
    : snapshot.nodes.map((node) => node.id)
  const accessibleNodeIdSet = new Set(accessibleNodeIds)

  if (!accessibleNodeIdSet.has(nodeId)) {
    return null
  }

  const node = snapshot.nodes.find((candidate) => candidate.id === nodeId)

  if (!node) {
    return null
  }

  const directRolesWithNodeId = toRoleMembers(roles, node.id)
  const childNodes = sortWorkspaceNodes(snapshot.nodes.filter((candidate) => candidate.parentNodeId === node.id && !candidate.isDeleted))
  const directWorkItems = sortWorkspaceWorkItems(snapshot.workItems.filter((item) => item.ownerNodeId === node.id && !item.isDeleted))
  const canManage = Boolean(
    userId &&
      roles.some(
        (role) =>
          role.userId === userId &&
          (options.requireDirectManagementRole
            ? role.nodeId === node.id
            : node.path.includes(role.nodeId)) &&
          canManageRole(role),
      ),
  )

  return {
    node,
    pathLabel: getNodePathLabel(node.id, snapshot.nodes),
    childNodes,
    directRoles: directRolesWithNodeId.map((role) => ({
      assignmentId: role.assignmentId,
      userId: role.userId,
      name: role.name,
      email: role.email,
      roleName: role.roleName,
      roleId: role.roleId,
      isTopRole: role.isTopRole,
    })),
    directWorkItems,
    inheritedManagers: getInheritedManagers(node, roles, snapshot.users, canManageRole),
    canManage,
    nextActions: [
      {
        label: '하위 조직 추가',
        description: '선택한 조직 아래 새 팀이나 프로젝트를 추가합니다.',
        href: `/setup/sub-node?parentNodeId=${node.id}`,
      },
      {
        label: '권한 부여',
        description: '운영에 필요한 권한을 사용자에게 추가합니다.',
        href: `/workspace?nodeId=${node.id}&view=roles`,
      },
      {
        label: '업무 등록',
        description: '이 조직에 연결할 새 업무를 등록합니다.',
        href: '/work-items/new',
      },
    ],
  }
}

export function getSelectedNodeDetail(
  nodeId: number,
  userId?: string,
  providedSnapshot?: WorkspaceSnapshot,
  options: SelectedNodeDetailOptions = {},
): SelectedNodeDetail | null {
  const snapshot = providedSnapshot ?? getOrgSnapshot()
  const cacheKey = getSelectedNodeDetailCacheKey(nodeId, userId, options)
  let snapshotCache = selectedNodeDetailCache.get(snapshot)

  if (snapshotCache?.has(cacheKey)) {
    return snapshotCache.get(cacheKey) ?? null
  }

  const detail = calculateSelectedNodeDetail(nodeId, snapshot, userId, options)
  snapshotCache ??= new Map<string, SelectedNodeDetail | null>()

  if (snapshotCache.size >= MAX_SELECTED_NODE_DETAIL_ENTRIES) {
    const oldestKey = snapshotCache.keys().next()
    if (!oldestKey.done) {
      snapshotCache.delete(oldestKey.value)
    }
  }

  snapshotCache.set(cacheKey, detail)
  selectedNodeDetailCache.set(snapshot, snapshotCache)
  return detail
}
