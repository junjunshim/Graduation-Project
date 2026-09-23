export type StandardRoleName = 'ADMIN' | 'MANAGER' | 'MEMBER' | 'VIEWER'
export type RoleName = StandardRoleName | (string & {})
export type StandardNodeType = 'USER' | 'COMPANY' | 'DIVISION' | 'DEPARTMENT' | 'TEAM' | 'PROJECT'
export type NodeType = StandardNodeType | (string & {})

export type WorkItemStatus = 'todo' | 'in-progress' | 'done'

export type UserRecord = {
  userId: string
  email: string
  name: string
  personalNodeId?: number
  createdAt: string
}

export type OrganizationNodeRecord = {
  id: number
  parentNodeId?: number
  nodeType: NodeType
  name: string
  path: number[]
  isDeleted?: boolean
  createdAt: string
  updatedAt?: string
}

export type RoleAssignmentRecord = {
  roleId?: number
  isTopRole?: boolean
  id: number
  userId: string
  nodeId: number
  roleName: RoleName
  isDeleted?: boolean
  createdAt: string
  updatedAt?: string
}

export type WorkItemRecord = {
  workItemId: string
  displayId?: number
  ownerNodeId: number
  ownerUserId: string
  title: string
  description: string
  category?: string
  status: WorkItemStatus
  priority: number
  hidden?: boolean
  weight: number
  /** 자체 진행률 (사용자가 입력한 값) */
  progress: number
  /** 자체 진행률과 하위 업무 진행률을 가중치로 합성한 진행률 (서버 계산, 조회 전용) */
  computedProgress?: number
  commentCount?: number
  isDeleted?: boolean
  startDate?: string
  dueDate?: string
  parentWorkItemId?: string
  createdAt: string
  updatedAt?: string
}

export type AuthorityRecord = {
  isTopRole?: boolean
  id: number
  nodeId: number
  roleName: RoleName
  authority: string
  updatedAt?: string
}

export type MentionRecord = {
  id: number
  commentId: number
  workItemId: string
  actorName?: string
  actorUserId?: string
  message: string
  isRead: boolean
  createdAt: string
  updatedAt?: string
}

export type WorkItemCommentRecord = {
  commentId: number
  authorUserId: string
  authorName: string
  authorEmail: string
  content: string
  createdAt: string
}

export type ActivityRecord = {
  id: number
  nodeId: number
  actorUserId: string
  actorName: string
  entityType: string
  entityId: string
  targetName: string
  actionType: string
  fieldName?: string | null
  oldValue?: string | null
  newValue?: string | null
  createdAt: string
}

export type WorkItemFileRecord = {
  id: number
  workItemId: string
  uploaderUserId: string
  uploaderName: string
  uploaderEmail: string
  originalFileName: string
  fileSize: number
  mimeType?: string | null
  isDeleted?: boolean
  createdAt: string
  updatedAt?: string
}

export type WorkspaceDatabase = {
  datasetId: string
  seedVersion: number
  users: UserRecord[]
  nodes: OrganizationNodeRecord[]
  roles: RoleAssignmentRecord[]
  workItems: WorkItemRecord[]
  authorities?: AuthorityRecord[]
  mentions?: MentionRecord[]
  activities?: ActivityRecord[]
  files?: WorkItemFileRecord[]
  serverTime?: string
  counters: {
    node: number
    role: number
  }
}

export type WorkspaceSnapshot = Pick<
  WorkspaceDatabase,
  'users' | 'nodes' | 'roles' | 'workItems' | 'authorities' | 'mentions' | 'activities' | 'files'
>

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
  roleId: number
  email: string
  nodeId: number
  roleName: RoleName
}

export type UpdateNodeRequest = {
  nodeId: number
  /** The checked-in server treats this PATCH as a full node update. */
  name: string
  nodeType: Exclude<NodeType, 'USER'>
}

export type UpdateRoleRequest = {
  roleId: number
  email: string
  nodeId: number
  roleName: RoleName
}

/** 역할 회수 시 이관해야 하는 미완료 업무 */
export type RoleRemovalWorkItem = {
  workItemId: string
  title: string
  ownerNodeId: number
  ownerNodeName: string
  isHidden: boolean
  status: string
}

/** 역할 회수 시 업무를 넘겨받을 수 있는 후보 사용자 */
export type RoleRemovalTransferTarget = {
  userId: string
  name: string
  email: string
}

/** 역할 회수 사전 확인 결과 */
export type RoleRemovalPreview = {
  canRemove: boolean
  blockedReason: string | null
  nodeId: number
  targetUserId: string
  targetUserName: string
  targetUserEmail: string
  roleId?: number
  roleName: RoleName
  isTopRole: boolean
  workItems: RoleRemovalWorkItem[]
  transferTargets: RoleRemovalTransferTarget[]
}

export type RemoveRoleRequest = {
  email: string
  nodeId: number
  /** 이관할 미완료 업무가 없으면 생략할 수 있다. */
  newOwnerEmail?: string
}

export type RemoveRoleResult = {
  transferredWorkItemCount: number
  clearedScheduleCount: number
  transferTargetName?: string
}

/** 역할 정의 삭제 시 이 역할을 배정받은 사용자 */
export type RoleDefinitionAssignee = {
  userId: string
  name: string
  email: string
}

/** 역할 정의 삭제 사전 확인 결과 */
export type RoleDefinitionDeletionPreview = {
  canDelete: boolean
  blockedReason: string | null
  nodeId: number
  roleId: number
  roleName: RoleName
  isTopRole: boolean
  assigneeCount: number
  assignees: RoleDefinitionAssignee[]
  /** 탈퇴한 사용자의 잔여 배정 수 (삭제를 막지 않고 역할과 함께 정리된다) */
  inactiveAssigneeCount: number
}

export type DeleteRoleDefinitionRequest = {
  nodeId: number
  roleId: number
  roleName: RoleName
}

export type CreateWorkItemRequest = {
  workItemId: string
  ownerNodeId: number
  ownerUserId: string
  title: string
  parentWorkItemId?: string
  description?: string
  category?: string
  hidden?: boolean
  status?: WorkItemStatus
  priority?: number
  weight?: number
  progress?: number
  startDate?: string
  dueDate?: string
}

export type UpdateWorkItemRequest = {
  workItemId: string
  title?: string
  description?: string
  category?: string
  hidden?: boolean
  status?: WorkItemStatus
  priority?: number
  weight?: number
  progress?: number
  startDate?: string
  dueDate?: string
  /** 빈 문자열은 최상위 업무로 이동을 의미한다. 값이 없으면 부모를 변경하지 않는다. */
  parentWorkItemId?: string
  /** 변경할 담당자의 userId. 값이 없으면 담당자를 변경하지 않는다. */
  ownerUserId?: string
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
  myWorkItemCount: number
  teamPoolWorkItemCount: number
  dueSoonWorkItemCount: number
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
  roleId?: number
  isTopRole?: boolean
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
  deletedWorkItems?: WorkItemRecord[]
  allWorkItems?: WorkItemRecord[]
  roots: WorkspaceNodeView[]
  urgentWorkItems: WorkItemRecord[]
  recentWorkItems: WorkItemRecord[]
  myWorkItems: WorkItemRecord[]
  teamPoolWorkItems: WorkItemRecord[]
  dueSoonWorkItems: WorkItemRecord[]
  rootNode?: OrganizationNodeRecord
  rootRoleMembers: RoleMember[]
  allRoleMembers?: RoleMember[]
  activities?: ActivityRecord[]
  files?: WorkItemFileRecord[]
  allFiles?: WorkItemFileRecord[]
  onboardingSteps: OnboardingStep[]
}

export type SelectedNodeDetail = {
  node: OrganizationNodeRecord
  pathLabel: string
  childNodes: OrganizationNodeRecord[]
  directRoles: RoleMember[]
  directWorkItems: WorkItemRecord[]
  inheritedManagers: UserRecord[]
  canManage: boolean
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
  suggestedDisplayCode: string
  availableNodes: OrganizationNodeRecord[]
  selectedNode: OrganizationNodeRecord | null
  pathLabel: string
  assignableUsers: UserRecord[]
  availableParentItems: WorkItemRecord[]
  existingCategories: string[]
}
