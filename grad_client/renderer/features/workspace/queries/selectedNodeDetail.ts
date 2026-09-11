import { resolveRoleAssignments } from '../model/roleDefinitions'
import { parseAuthorityBitSet } from '../model/authorityDefinitions'
import type {
  OrganizationNodeRecord,
  RoleMember,
  SelectedNodeDetail,
  WorkspaceSnapshot,
} from '../model/types'
import { getAccessibleNodeIdsForUser, getNodePathLabel, getOrgSnapshot } from '../data/orgService'
import { sortWorkspaceNodes, sortWorkspaceWorkItems } from '../model/sorters'

type SelectedNodeDetailOptions = {
  requireDirectManagementRole?: boolean
}

function getInheritedManagers(
  node: OrganizationNodeRecord,
  roles: Array<RoleMember & { nodeId: number }>,
  users: ReturnType<typeof getOrgSnapshot>['users'],
  canManageRole: (role: RoleMember & { nodeId: number }) => boolean,
) {
  const inheritedIds = Array.from(
    new Set(
      roles
        .filter((role) => node.path.includes(role.nodeId) && canManageRole(role))
        .map((role) => role.userId),
    ),
  )

  return users.filter((user) => inheritedIds.includes(user.userId))
}

function toRoleMembers(snapshot: ReturnType<typeof getOrgSnapshot>, nodeId: number) {
  return snapshot.roles
    .filter((role) => role.nodeId === nodeId)
    .map((role) => {
      const user = snapshot.users.find((candidate) => candidate.userId === role.userId)

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
    .sort((left, right) => left.name.localeCompare(right.name, 'ko'))
}

export function getSelectedNodeDetail(
  nodeId: number,
  userId?: string,
  providedSnapshot?: WorkspaceSnapshot,
  options: SelectedNodeDetailOptions = {},
): SelectedNodeDetail | null {
  const source = providedSnapshot ?? getOrgSnapshot()
  const snapshot = { ...source, roles: resolveRoleAssignments(source.roles, source.authorities ?? []) }
  const canManageRole = (role: RoleMember & { nodeId: number }) => {
    const definition = snapshot.authorities?.find((a) => a.id === role.roleId && a.nodeId === role.nodeId)
    if (!definition) return false
    const bits = parseAuthorityBitSet(definition.authority)
    return !bits.has(23) && (definition.isTopRole === true || bits.has(15))
  }
  const accessibleNodeIds = userId
    ? getAccessibleNodeIdsForUser(userId, snapshot)
    : snapshot.nodes.map((node) => node.id)

  if (!accessibleNodeIds.includes(nodeId)) {
    return null
  }

  const node = snapshot.nodes.find((candidate) => candidate.id === nodeId)

  if (!node) {
    return null
  }

  const directRolesWithNodeId = toRoleMembers(snapshot, node.id)
  const allRolesWithNodeId = snapshot.roles.map((role) => {
    const user = snapshot.users.find((candidate) => candidate.userId === role.userId)

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
  const childNodes = sortWorkspaceNodes(snapshot.nodes.filter((candidate) => candidate.parentNodeId === node.id))
  const directWorkItems = sortWorkspaceWorkItems(snapshot.workItems.filter((item) => item.ownerNodeId === node.id))
  const canManage = Boolean(
    userId &&
      allRolesWithNodeId.some(
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
    inheritedManagers: getInheritedManagers(node, allRolesWithNodeId, snapshot.users, canManageRole),
    canManage,
    nextActions: [
      {
        label: '하위 조직 추가',
        description: '선택한 조직 아래 새 팀이나 프로젝트를 추가합니다.',
        href: '/org/manage',
      },
      {
        label: '권한 부여',
        description: '운영에 필요한 권한을 사용자에게 추가합니다.',
        href: '/org/manage',
      },
      {
        label: '업무 등록',
        description: '이 조직에 연결할 새 업무를 등록합니다.',
        href: '/work-items/new',
      },
    ],
  }
}
