import type {
  OnboardingStep,
  OrganizationNodeRecord,
  RoleMember,
  RoleName,
  UserRecord,
  WorkItemRecord,
  WorkspaceNodeView,
  WorkspaceOverview,
  WorkspaceSnapshot,
} from '../model/types'
import { getAccessibleNodeIdsForUser, getOrgSnapshot, getWorkspaceSummary } from '../data/orgService'
import { getCurrentUser } from '../data/userService'
import { sortWorkspaceNodes, sortWorkspaceWorkItems } from '../model/sorters'

function isDueSoon(item: WorkItemRecord) {
  if (!item.dueDate || item.status === 'done') {
    return false
  }

  const dueDate = new Date(item.dueDate)
  const threshold = new Date()
  threshold.setDate(threshold.getDate() + 7)

  return !Number.isNaN(dueDate.getTime()) && dueDate <= threshold
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

function toRoleMember(
  assignmentId: number,
  userId: string,
  roleName: RoleName,
  usersById: ReadonlyMap<string, UserRecord>,
): RoleMember {
  const user = usersById.get(userId)

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
  const nodeNamesById = new Map(nodes.map((node) => [node.id, node.name]))

  nodes.forEach((node) => {
    nodeMap.set(node.id, {
      id: node.id,
      title: node.name,
      nodeType: node.nodeType,
      path: node.path.map((pathNodeId) => nodeNamesById.get(pathNodeId) ?? `Node ${pathNodeId}`).join(' / '),
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

export function getWorkspaceOverview(userId?: string, providedSnapshot?: WorkspaceSnapshot): WorkspaceOverview {
  const snapshot = providedSnapshot ?? getOrgSnapshot()
  const currentUser = getCurrentUser(snapshot)
  const resolvedUserId = userId ?? currentUser?.userId
  const accessibleNodeIds = resolvedUserId ? getAccessibleNodeIdsForUser(resolvedUserId, snapshot) : []
  const accessibleNodeIdSet = new Set(accessibleNodeIds)
  const summary = getWorkspaceSummary(resolvedUserId, snapshot)
  const visibleNodes = sortWorkspaceNodes(snapshot.nodes.filter((node) => accessibleNodeIdSet.has(node.id)))
  const visibleWorkItems = sortWorkspaceWorkItems(
    snapshot.workItems.filter((item) => accessibleNodeIdSet.has(item.ownerNodeId)),
  )
  const roots = buildWorkspaceTree(visibleNodes, visibleWorkItems)
  const myWorkItems = sortWorkspaceWorkItems(
    visibleWorkItems.filter((item) => item.ownerUserId === resolvedUserId),
  )
  const teamPoolWorkItems = sortWorkspaceWorkItems(
    visibleWorkItems.filter((item) => item.ownerUserId !== resolvedUserId && item.status !== 'done'),
  )
  const dueSoonWorkItems = sortWorkspaceWorkItems(visibleWorkItems.filter(isDueSoon))
  const urgentWorkItemIds = new Set<string>()
  const urgentWorkItems = sortWorkspaceWorkItems(
    [...dueSoonWorkItems, ...visibleWorkItems.filter((item) => item.priority <= 2 && item.status !== 'done')].filter(
      (item) => {
        if (urgentWorkItemIds.has(item.workItemId)) {
          return false
        }

        urgentWorkItemIds.add(item.workItemId)
        return true
      },
    ),
  )
  const rootNode =
    visibleNodes.find((node) => node.nodeType !== 'USER' && node.path.length === 1) ??
    visibleNodes.find((node) => node.nodeType !== 'USER')

  const usersById = new Map(snapshot.users.map((user) => [user.userId, user]))
  const nodesById = new Map(snapshot.nodes.map((node) => [node.id, node]))
  const rootRoleMembers = rootNode
    ? snapshot.roles
        .filter((role) => role.nodeId === rootNode.id)
        .map((role) => toRoleMember(role.id, role.userId, role.roleName, usersById))
        .sort((left, right) => left.name.localeCompare(right.name, 'ko'))
    : []

  const orgRoles = snapshot.roles.filter((role) => {
    const node = nodesById.get(role.nodeId)
    return node?.nodeType !== 'USER'
  })

  return {
    summary,
    accessibleNodeIds,
    visibleNodes,
    visibleWorkItems,
    roots,
    urgentWorkItems,
    recentWorkItems: [...visibleWorkItems]
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 4),
    myWorkItems,
    teamPoolWorkItems,
    dueSoonWorkItems,
    rootNode,
    rootRoleMembers,
    onboardingSteps: buildOnboardingSteps({
      hasPersonalSpace: Boolean(currentUser?.personalNodeId),
      hasTopNode: summary.orgNodeCount > 0,
      hasSubNodeOrRole:
        summary.orgNodeCount > 1 || orgRoles.filter((role) => accessibleNodeIdSet.has(role.nodeId)).length > 1,
      hasWorkItem: summary.workItemCount > 0,
    }),
  }
}
