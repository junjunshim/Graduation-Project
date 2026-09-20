import { resolveRoleAssignments } from '../model/roleDefinitions'
import type {
  AssignRoleRequest,
  CreateSubNodeRequest,
  CreateTopNodeRequest,
  OrganizationNodeRecord,
  UpdateNodeRequest,
  UpdateRoleRequest,
  WorkspaceSnapshot,
  WorkspaceSummary,
} from '../model/types'
import { isWorkItemDueSoon } from '../model/workItemDue'
import { readWorkspaceDb } from './localStore'
import {
  assignRoleOnServer,
  createSubNodeOnServer,
  createTopNodeOnServer,
  deleteNodeOnServer,
  fetchNodeDetailOnServer,
  loadWorkspaceDirectoryScopeOnServer,
  restoreNodeOnServer,
  updateNodeOnServer,
  updateRoleOnServer,
} from './serverWorkspace'

export function getAccessibleNodeIdsForUser(_userId: string, snapshot?: WorkspaceSnapshot) {
  const workspace = snapshot ?? readWorkspaceDb()

  // snapshot이 명시적으로 전달된 경우(특정 스코프로 축소된 스냅샷 포함), 해당 snapshot에 포함된 노드 ID들을 반환합니다.
  if (snapshot) {
    return snapshot.nodes.map((node) => node.id)
  }

  // GET /context/init 이 이미 권한 계산을 거친 접근 가능한 노드들만 전달하므로,
  // 로컬에 존재하는 노드들을 그대로 접근 가능한 노드로 취급합니다.
  return workspace.nodes.map((node) => node.id)
}

export function getNodePathLabel(nodeId: number, nodes?: OrganizationNodeRecord[]) {
  const db = nodes ? null : readWorkspaceDb()
  const sourceNodes = nodes ?? db?.nodes ?? []
  const node = sourceNodes.find((candidate) => candidate.id === nodeId)

  if (!node) {
    return '경로 없음'
  }

  return node.path
    .map((pathNodeId) => sourceNodes.find((candidate) => candidate.id === pathNodeId)?.name ?? `Node ${pathNodeId}`)
    .join(' / ')
}

/**
 * 진입점/워크스페이스 화면용 스냅샷.
 * 기본값은 살아있는 노드만 담고, 휴지통(삭제된 워크스페이스 목록)을 그릴 때만 includeDeleted 를 켠다.
 */
export function getOrgSnapshot(options?: { includeDeleted?: boolean }): WorkspaceSnapshot {
  const db = readWorkspaceDb()
  const activeNodes = options?.includeDeleted
    ? db.nodes
    : db.nodes.filter((node) => !node.isDeleted)
  const activeNodeIds = new Set(activeNodes.map((node) => node.id))

  return {
    users: db.users.map((user) => ({ ...user })),
    nodes: activeNodes.map((node) => ({ ...node, path: [...node.path] })),
    roles: resolveRoleAssignments(db.roles, db.authorities ?? [])
      .filter((role) => !role.isDeleted && activeNodeIds.has(role.nodeId))
      .map((role) => ({ ...role })),
    workItems: db.workItems
      .filter((item) => activeNodeIds.has(item.ownerNodeId))
      .map((item) => ({ ...item })),
    authorities: (db.authorities ?? []).map((auth) => ({ ...auth })),
    mentions: (db.mentions ?? []).map((m) => ({ ...m })),
    activities: (db.activities ?? []).map((act) => ({ ...act })),
    files: (db.files ?? []).map((f) => ({ ...f })),
  }
}

export async function fetchNodeDetail(nodeId: number | string): Promise<WorkspaceSnapshot> {
  await fetchNodeDetailOnServer(nodeId)
  return getOrgSnapshot()
}

export async function fetchWorkspaceDirectoryScope(options?: {
  includeDeleted?: boolean
}): Promise<WorkspaceSnapshot> {
  await loadWorkspaceDirectoryScopeOnServer()
  return getOrgSnapshot(options)
}

export function getWorkspaceSummary(userId?: string, snapshot?: WorkspaceSnapshot): WorkspaceSummary {
  if (!userId) {
    return {
      nodeCount: 0,
      workItemCount: 0,
      roleCount: 0,
      hasContext: false,
      personalNodeCount: 0,
      orgNodeCount: 0,
      rootWorkItemCount: 0,
      childWorkItemCount: 0,
      averageProgress: 0,
      myWorkItemCount: 0,
      teamPoolWorkItemCount: 0,
      dueSoonWorkItemCount: 0,
    }
  }

  const workspace = snapshot ?? readWorkspaceDb()
  const visibleNodeIds = getAccessibleNodeIdsForUser(userId, workspace)
  const visibleNodeIdSet = new Set(visibleNodeIds)
  const visibleWorkItems = workspace.workItems.filter(
    (item) => visibleNodeIdSet.has(item.ownerNodeId) && !item.isDeleted,
  )
  const visibleNodes = workspace.nodes.filter((node) => visibleNodeIdSet.has(node.id) && !node.isDeleted)
  const now = new Date()
  const dueSoonThreshold = new Date(now)
  dueSoonThreshold.setDate(now.getDate() + 7)

  return {
    nodeCount: visibleNodes.length,
    workItemCount: visibleWorkItems.length,
    roleCount: workspace.roles.filter((role) => role.userId === userId).length,
    hasContext: visibleNodes.length > 0,
    personalNodeCount: visibleNodes.filter((node) => node.nodeType === 'USER').length,
    orgNodeCount: visibleNodes.filter((node) => node.nodeType !== 'USER').length,
    rootWorkItemCount: visibleWorkItems.filter((item) => !item.parentWorkItemId).length,
    childWorkItemCount: visibleWorkItems.filter((item) => Boolean(item.parentWorkItemId)).length,
    averageProgress:
      visibleWorkItems.length > 0
        ? Math.round(
            visibleWorkItems.reduce((total, item) => total + (item.computedProgress ?? item.progress), 0) /
              visibleWorkItems.length,
          )
        : 0,
    myWorkItemCount: visibleWorkItems.filter((item) => item.ownerUserId === userId).length,
    teamPoolWorkItemCount: visibleWorkItems.filter((item) => item.ownerUserId !== userId).length,
    dueSoonWorkItemCount: visibleWorkItems.filter(isWorkItemDueSoon).length,
  }
}

export async function createTopNode(payload: CreateTopNodeRequest) {
  return createTopNodeOnServer(payload)
}

export async function createSubNode(payload: CreateSubNodeRequest) {
  return createSubNodeOnServer(payload)
}

export async function assignRoleToNode(payload: AssignRoleRequest) {
  return assignRoleOnServer(payload)
}

export async function updateNode(payload: UpdateNodeRequest) {
  return updateNodeOnServer(payload)
}

export async function updateRole(payload: UpdateRoleRequest) {
  return updateRoleOnServer(payload)
}

export async function deleteWorkspace(nodeId: number) {
  return deleteNodeOnServer(nodeId)
}

export async function restoreWorkspace(nodeId: number, cascade = true) {
  return restoreNodeOnServer(nodeId, cascade)
}
