import type {
  OrganizationNodeRecord,
  RoleMember,
  SelectedNodeDetail,
  WorkItemRecord,
} from '../model/types'
import { getAccessibleNodeIdsForUser, getNodePathLabel, getOrgSnapshot } from '../data/orgService'

function compareByDate(left?: string, right?: string) {
  return (left ?? '9999-12-31').localeCompare(right ?? '9999-12-31')
}

function sortNodes(nodes: OrganizationNodeRecord[]) {
  return [...nodes].sort((left, right) => {
    return left.path.length - right.path.length || left.name.localeCompare(right.name, 'ko')
  })
}

function sortWorkItems(workItems: WorkItemRecord[]) {
  return [...workItems].sort((left, right) => {
    return (
      compareByDate(left.dueDate, right.dueDate) ||
      right.priority - left.priority ||
      left.title.localeCompare(right.title, 'ko')
    )
  })
}

function getInheritedManagers(
  node: OrganizationNodeRecord,
  roles: Array<RoleMember & { nodeId: number }>,
  users: ReturnType<typeof getOrgSnapshot>['users'],
) {
  const inheritedIds = Array.from(
    new Set(
      roles
        .filter((role) => node.path.includes(role.nodeId) && (role.roleName === 'ADMIN' || role.roleName === 'MANAGER'))
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
      }
    })
    .sort((left, right) => left.name.localeCompare(right.name, 'ko'))
}

export function getSelectedNodeDetail(nodeId: number, userId?: string): SelectedNodeDetail | null {
  const snapshot = getOrgSnapshot()
  const accessibleNodeIds = userId ? getAccessibleNodeIdsForUser(userId) : snapshot.nodes.map((node) => node.id)

  if (!accessibleNodeIds.includes(nodeId)) {
    return null
  }

  const node = snapshot.nodes.find((candidate) => candidate.id === nodeId)

  if (!node) {
    return null
  }

  const directRolesWithNodeId = toRoleMembers(snapshot, node.id)
  const childNodes = sortNodes(snapshot.nodes.filter((candidate) => candidate.parentNodeId === node.id))
  const directWorkItems = sortWorkItems(snapshot.workItems.filter((item) => item.ownerNodeId === node.id))

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
    })),
    directWorkItems,
    inheritedManagers: getInheritedManagers(node, directRolesWithNodeId, snapshot.users),
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
