import type {
  AssignRoleRequest,
  CreateSubNodeRequest,
  DeleteRoleDefinitionRequest,
  CreateTopNodeRequest,
  OrganizationNodeRecord,
  RemoveRoleRequest,
  UpdateNodeRequest,
  UpdateRoleRequest,
  WorkspaceSnapshot,
  WorkspaceSummary,
} from '../model/types'
import { getWorkspaceTodayTimestamp, isWorkItemDueSoon } from '../model/workItemDue.js'
import { getWorkspaceRevision, readWorkspaceDb } from './localStore.js'
import { queryWithCache } from './queryCache.js'
import {
  assignRoleOnServer,
  createSubNodeOnServer,
  createTopNodeOnServer,
  deleteNodeOnServer,
  deleteRoleDefinitionOnServer,
  fetchNodeDetailOnServer,
  fetchRoleDefinitionDeletionPreviewOnServer,
  fetchRoleRemovalPreviewOnServer,
  loadWorkspaceDirectoryScopeOnServer,
  removeRoleOnServer,
  restoreNodeOnServer,
  updateNodeOnServer,
  updateRoleOnServer,
} from './serverWorkspace.js'

const nodeIndexCache = new WeakMap<OrganizationNodeRecord[], Map<number, OrganizationNodeRecord>>()
const WORKSPACE_NODE_CACHE_TTL_MS = 30_000
const WORKSPACE_SCOPE_CACHE_TTL_MS = 30_000

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
  let nodeIndex = nodeIndexCache.get(sourceNodes)

  if (!nodeIndex) {
    nodeIndex = new Map<number, OrganizationNodeRecord>()
    sourceNodes.forEach((node) => {
      if (!nodeIndex?.has(node.id)) {
        nodeIndex?.set(node.id, node)
      }
    })
    nodeIndexCache.set(sourceNodes, nodeIndex)
  }

  const node = nodeIndex.get(nodeId)

  if (!node) {
    return '경로 없음'
  }

  return node.path
    .map((pathNodeId) => nodeIndex?.get(pathNodeId)?.name ?? `Node ${pathNodeId}`)
    .join(' / ')
}

/**
 * 진입점/워크스페이스 화면용 스냅샷.
 * 기본값은 살아있는 노드만 담고, 휴지통(삭제된 워크스페이스 목록)을 그릴 때만 includeDeleted 를 켠다.
 * DB revision 이 바뀌면 무조건 새 스냅샷을 만들므로, 서버에서 삭제된 항목이 캐시에 남지 않는다.
 */
const orgSnapshotCache = new Map<boolean, { revision: number; snapshot: WorkspaceSnapshot }>()

export function getOrgSnapshot(options?: { includeDeleted?: boolean }): WorkspaceSnapshot {
  const includeDeleted = options?.includeDeleted === true
  const revision = getWorkspaceRevision()
  const cached = orgSnapshotCache.get(includeDeleted)

  if (cached?.revision === revision) {
    return cached.snapshot
  }

  const db = readWorkspaceDb()
  const activeNodes = includeDeleted
    ? db.nodes
    : db.nodes.filter((node) => !node.isDeleted)
  const activeNodeIds = new Set(activeNodes.map((node) => node.id))

  const snapshot: WorkspaceSnapshot = {
    users: db.users.map((user) => ({ ...user })),
    nodes: activeNodes.map((node) => ({ ...node, path: [...node.path] })),
    // normalizeServerWorkspaceDb 단계에서 이미 역할 정의가 결합되어 있으므로 여기서 다시 계산하지 않는다.
    roles: db.roles
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

  orgSnapshotCache.set(includeDeleted, { revision, snapshot })
  return snapshot
}

export async function fetchNodeDetail(
  nodeId: number | string,
  options: { forceRefresh?: boolean } = {},
): Promise<WorkspaceSnapshot> {
  await queryWithCache(
    `workspace:node:${String(nodeId)}`,
    () => fetchNodeDetailOnServer(nodeId),
    { ttlMs: WORKSPACE_NODE_CACHE_TTL_MS, forceRefresh: options.forceRefresh },
  )
  return getOrgSnapshot()
}

export async function fetchWorkspaceDirectoryScope(options?: {
  includeDeleted?: boolean
  forceRefresh?: boolean
}): Promise<WorkspaceSnapshot> {
  const includeDeleted = options?.includeDeleted === true
  await queryWithCache(
    `workspace:scope:${includeDeleted ? 'all' : 'active'}`,
    () => loadWorkspaceDirectoryScopeOnServer(),
    { ttlMs: WORKSPACE_SCOPE_CACHE_TTL_MS, forceRefresh: options?.forceRefresh },
  )
  return getOrgSnapshot({ includeDeleted })
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
  const todayTimestamp = getWorkspaceTodayTimestamp()

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
    dueSoonWorkItemCount: visibleWorkItems.filter((item) =>
      isWorkItemDueSoon(item, todayTimestamp),
    ).length,
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

/** 역할 회수 전, 이관해야 할 업무와 이관 가능한 대상 목록을 조회한다. */
export async function fetchRoleRemovalPreview(email: string, nodeId: number) {
  return fetchRoleRemovalPreviewOnServer(email, nodeId)
}

export async function removeRole(payload: RemoveRoleRequest) {
  return removeRoleOnServer(payload)
}

/** 역할 정의 삭제 전, 이 역할을 배정받은 사용자가 남아 있는지 조회한다. */
export async function fetchRoleDefinitionDeletionPreview(nodeId: number, roleId: number) {
  return fetchRoleDefinitionDeletionPreviewOnServer(nodeId, roleId)
}

export async function deleteRoleDefinition(payload: DeleteRoleDefinitionRequest) {
  return deleteRoleDefinitionOnServer(payload)
}

export async function deleteWorkspace(nodeId: number) {
  return deleteNodeOnServer(nodeId)
}

export async function restoreWorkspace(nodeId: number, cascade = true) {
  return restoreNodeOnServer(nodeId, cascade)
}
