import type { RoleName, WorkspaceSnapshot } from '../model/types'

const SERVER_WORK_ITEM_MEMBER_ROLES = new Set<RoleName>(['ADMIN', 'MANAGER', 'MEMBER'])

export function getServerCreatableNodeIds(userId: string, snapshot: WorkspaceSnapshot) {
  return new Set(
    snapshot.roles
      .filter(
        (role) =>
          role.userId === userId && SERVER_WORK_ITEM_MEMBER_ROLES.has(role.roleName),
      )
      .map((role) => role.nodeId),
  )
}

export function getServerAssignableUsers(nodeId: number, snapshot: WorkspaceSnapshot) {
  const userIds = new Set(
    snapshot.roles
      .filter(
        (role) =>
          role.nodeId === nodeId && SERVER_WORK_ITEM_MEMBER_ROLES.has(role.roleName),
      )
      .map((role) => role.userId),
  )

  return snapshot.users.filter((user) => userIds.has(user.userId) && Boolean(user.email))
}

export function getServerAvailableParentItems(
  userId: string,
  selectedNodePath: number[],
  snapshot: WorkspaceSnapshot,
) {
  const directRoleNodeIds = new Set(
    snapshot.roles.filter((role) => role.userId === userId).map((role) => role.nodeId),
  )

  return snapshot.workItems.filter(
    (item) =>
      selectedNodePath.includes(item.ownerNodeId) && directRoleNodeIds.has(item.ownerNodeId),
  )
}
