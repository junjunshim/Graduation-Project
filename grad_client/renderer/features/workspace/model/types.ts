export type RoleName = 'ADMIN' | 'MANAGER' | 'MEMBER'

export type NodeType = 'USER' | 'COMPANY' | 'DIVISION' | 'DEPARTMENT' | 'TEAM' | 'PROJECT'

export type WorkItemStatus = 'todo' | 'in-progress' | 'done'

export type UserRecord = {
  userId: string
  email: string
  name: string
  password: string
  personalNodeId?: number
  createdAt: string
}

export type OrganizationNodeRecord = {
  id: number
  parentNodeId?: number
  nodeType: NodeType
  name: string
  path: number[]
  createdAt: string
}

export type RoleAssignmentRecord = {
  id: number
  userId: string
  nodeId: number
  roleName: RoleName
  createdAt: string
}

export type WorkItemRecord = {
  workItemId: string
  ownerNodeId: number
  ownerUserId: string
  title: string
  description: string
  status: WorkItemStatus
  priority: number
  weight: number
  progress: number
  startDate?: string
  dueDate?: string
  parentWorkItemId?: string
  createdAt: string
}

export type WorkspaceDatabase = {
  datasetId: string
  seedVersion: number
  users: UserRecord[]
  nodes: OrganizationNodeRecord[]
  roles: RoleAssignmentRecord[]
  workItems: WorkItemRecord[]
  counters: {
    node: number
    role: number
  }
}

export type WorkspaceSnapshot = Pick<WorkspaceDatabase, 'users' | 'nodes' | 'roles' | 'workItems'>

export type SignUpRequest = {
  userId: string
  email: string
  name: string
  password: string
}

export type SignInRequest = {
  email: string
  password: string
}

export type SignInResponse =
  | {
      status: 'success'
      user: UserRecord
    }
  | {
      status: 'error'
      message: string
    }

export type CreateTopNodeRequest = {
  nodeType: Exclude<NodeType, 'USER'>
  name: string
  userId: string
  roleName: RoleName
}

export type CreateSubNodeRequest = {
  nodeType: Exclude<NodeType, 'USER'>
  parentNodeId: number
  name: string
  email: string
  roleName: RoleName
}

export type AssignRoleRequest = {
  email: string
  nodeId: number
  roleName: RoleName
}

export type CreateWorkItemRequest = {
  workItemId: string
  ownerNodeId: number
  ownerUserId: string
  title: string
  parentWorkItemId?: string
  description?: string
  status?: WorkItemStatus
  priority?: number
  weight?: number
  progress?: number
  startDate?: string
  dueDate?: string
}

export type WorkspaceSummary = {
  nodeCount: number
  workItemCount: number
  roleCount: number
  hasContext: boolean
  personalNodeCount: number
  orgNodeCount: number
  rootWorkItemCount: number
  childWorkItemCount: number
  averageProgress: number
}

export type WorkspaceNodeView = {
  id: number
  title: string
  nodeType: NodeType
  path: string
  pathIds: number[]
  children: WorkspaceNodeView[]
  workItems: WorkItemRecord[]
}

export type OnboardingStep = {
  id: 'personal-space' | 'top-node' | 'sub-node-role' | 'work-item'
  title: string
  description: string
  href: string
  status: 'complete' | 'current' | 'upcoming'
}

export type RoleMember = {
  assignmentId: number
  userId: string
  name: string
  email: string
  roleName: RoleName
}

export type WorkspaceOverview = {
  summary: WorkspaceSummary
  accessibleNodeIds: number[]
  visibleNodes: OrganizationNodeRecord[]
  visibleWorkItems: WorkItemRecord[]
  roots: WorkspaceNodeView[]
  urgentWorkItems: WorkItemRecord[]
  recentWorkItems: WorkItemRecord[]
  rootNode?: OrganizationNodeRecord
  rootRoleMembers: RoleMember[]
  onboardingSteps: OnboardingStep[]
}

export type SelectedNodeDetail = {
  node: OrganizationNodeRecord
  pathLabel: string
  childNodes: OrganizationNodeRecord[]
  directRoles: RoleMember[]
  directWorkItems: WorkItemRecord[]
  inheritedManagers: UserRecord[]
  nextActions: Array<{
    label: string
    description: string
    href: string
  }>
}

export type SelectedWorkItemDetail = {
  item: WorkItemRecord
  ownerNode: OrganizationNodeRecord
  ownerUser: UserRecord
  ownerNodePathLabel: string
  parentWorkItem: WorkItemRecord | null
  childWorkItems: WorkItemRecord[]
}

export type WorkItemComposerContext = {
  suggestedWorkItemId: string
  availableNodes: OrganizationNodeRecord[]
  selectedNode: OrganizationNodeRecord | null
  pathLabel: string
  assignableUsers: UserRecord[]
  availableParentItems: WorkItemRecord[]
}
