import type {
  OnboardingStep,
  OrganizationNodeRecord,
  RoleMember,
  RoleName,
  UserRecord,
  WorkItemRecord,
  WorkspaceNodeView,
  WorkspaceOverview,
} from '../model/types'
import { getAccessibleNodeIdsForUser, getNodePathLabel, getOrgSnapshot, getWorkspaceSummary } from '../data/orgService'
import { getCurrentUser } from '../data/userService'

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

function buildOnboardingSteps({
  hasPersonalSpace,
  hasTopNode,
  hasSubNodeOrRole,
  hasWorkItem,
}: {
  hasPersonalSpace: boolean
  hasTopNode: boolean
  hasSubNodeOrRole: boolean
  hasWorkItem: boolean
}): OnboardingStep[] {
  const steps: Array<Omit<OnboardingStep, 'status'>> = [
    {
      id: 'personal-space',
      title: '개인 공간 준비 완료',
      description: '계정과 개인 공간이 준비되었습니다.',
      href: '/signup',
    },
    {
      id: 'top-node',
      title: '공유 공간 만들기',
      description: '팀이 함께 사용할 첫 공간을 등록해 주세요.',
      href: '/setup/top-node',
    },
    {
      id: 'sub-node-role',
      title: '조직과 권한 설정',
      description: '하위 조직을 만들고 담당 권한을 배치해 주세요.',
      href: '/org/manage',
    },
    {
      id: 'work-item',
      title: '첫 업무 등록',
      description: '운영할 업무를 등록하고 진행을 시작해 주세요.',
      href: '/work-items/new',
    },
  ]

  const completion = [hasPersonalSpace, hasTopNode, hasSubNodeOrRole, hasWorkItem]
  const currentIndex = completion.findIndex((isComplete) => !isComplete)

  return steps.map((step, index) => {
    let status: OnboardingStep['status'] = 'upcoming'

    if (completion[index]) {
      status = 'complete'
    } else if (currentIndex === -1 || currentIndex === index) {
      status = 'current'
    }

    return {
      ...step,
      status,
    }
  })
}

function toRoleMember(assignmentId: number, userId: string, roleName: RoleName, users: UserRecord[]): RoleMember {
  const user = users.find((candidate) => candidate.userId === userId)

  return {
    assignmentId,
    userId,
    name: user?.name ?? userId,
    email: user?.email ?? '',
    roleName,
  }
}

function buildWorkspaceTree(nodes: OrganizationNodeRecord[], workItems: WorkItemRecord[]): WorkspaceNodeView[] {
  const nodeMap = new Map<number, WorkspaceNodeView>()

  nodes.forEach((node) => {
    nodeMap.set(node.id, {
      id: node.id,
      title: node.name,
      nodeType: node.nodeType,
      path: getNodePathLabel(node.id, nodes),
      pathIds: [...node.path],
      children: [],
      workItems: [],
    })
  })

  workItems.forEach((item) => {
    nodeMap.get(item.ownerNodeId)?.workItems.push(item)
  })

  const roots: WorkspaceNodeView[] = []

  nodes.forEach((node) => {
    const currentNode = nodeMap.get(node.id)

    if (!currentNode) {
      return
    }

    if (node.parentNodeId && nodeMap.has(node.parentNodeId)) {
      nodeMap.get(node.parentNodeId)?.children.push(currentNode)
      return
    }

    roots.push(currentNode)
  })

  return roots
}

export function getWorkspaceOverview(userId = getCurrentUser()?.userId): WorkspaceOverview {
  const currentUser = getCurrentUser()
  const snapshot = getOrgSnapshot()
  const summary = getWorkspaceSummary(userId)
  const accessibleNodeIds = userId ? getAccessibleNodeIdsForUser(userId) : []
  const visibleNodes = sortNodes(snapshot.nodes.filter((node) => accessibleNodeIds.includes(node.id)))
  const visibleWorkItems = sortWorkItems(
    snapshot.workItems.filter((item) => accessibleNodeIds.includes(item.ownerNodeId)),
  )
  const roots = buildWorkspaceTree(visibleNodes, visibleWorkItems)
  const rootNode =
    visibleNodes.find((node) => node.nodeType !== 'USER' && node.path.length === 1) ??
    visibleNodes.find((node) => node.nodeType !== 'USER')

  const rootRoleMembers = rootNode
    ? snapshot.roles
        .filter((role) => role.nodeId === rootNode.id)
        .map((role) => toRoleMember(role.id, role.userId, role.roleName, snapshot.users))
        .sort((left, right) => left.name.localeCompare(right.name, 'ko'))
    : []

  const orgRoles = snapshot.roles.filter((role) => {
    const node = snapshot.nodes.find((candidate) => candidate.id === role.nodeId)
    return node?.nodeType !== 'USER'
  })

  return {
    summary,
    accessibleNodeIds,
    visibleNodes,
    visibleWorkItems,
    roots,
    urgentWorkItems: [...visibleWorkItems],
    recentWorkItems: [...visibleWorkItems]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 4),
    rootNode,
    rootRoleMembers,
    onboardingSteps: buildOnboardingSteps({
      hasPersonalSpace: Boolean(currentUser?.personalNodeId),
      hasTopNode: summary.orgNodeCount > 0,
      hasSubNodeOrRole:
        summary.orgNodeCount > 1 || orgRoles.filter((role) => accessibleNodeIds.includes(role.nodeId)).length > 1,
      hasWorkItem: summary.workItemCount > 0,
    }),
  }
}
