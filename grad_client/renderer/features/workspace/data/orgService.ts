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
import { delay, getUserByEmail, nowIso, readWorkspaceDb, writeWorkspaceDb } from './localStore'
import {
  assignRoleOnServer,
  createSubNodeOnServer,
  createTopNodeOnServer,
  fetchNodeDetailOnServer,
  updateNodeOnServer,
  updateRoleOnServer,
} from './serverWorkspace'
import { isServerDataSource } from './workspaceMode'

function getDescendantNodeIds(rootIds: number[], nodes: OrganizationNodeRecord[]) {
  const visited = new Set<number>()
  const queue = [...rootIds]
  const childIdsByParentId = new Map<number, number[]>()

  nodes.forEach((node) => {
    if (!node.parentNodeId) {
      return
    }

    const childIds = childIdsByParentId.get(node.parentNodeId) ?? []
    childIds.push(node.id)
    childIdsByParentId.set(node.parentNodeId, childIds)
  })

  for (let index = 0; index < queue.length; index += 1) {
    const currentId = queue[index]

    if (!currentId || visited.has(currentId)) {
      continue
    }

    visited.add(currentId)

    childIdsByParentId.get(currentId)?.forEach((childId) => {
      if (!visited.has(childId)) {
        queue.push(childId)
      }
    })
  }

  return Array.from(visited)
}

export function getAccessibleNodeIdsForUser(userId: string, snapshot?: WorkspaceSnapshot) {
  const workspace = snapshot ?? readWorkspaceDb()

  // snapshot이 명시적으로 전달된 경우(특정 스코프로 축소된 스냅샷 포함), 해당 snapshot에 포함된 노드 ID들을 반환합니다.
  if (snapshot) {
    return snapshot.nodes.map((node) => node.id)
  }

  // 서버 모드에서는 GET /context/init이 이미 권한 계산을 거친 접근 가능한 노드들만 전달하므로,
  // 로컬에 존재하는 노드들을 그대로 접근 가능한 노드로 취급합니다.
  if (isServerDataSource()) {
    return workspace.nodes.map((node) => node.id)
  }

  const user = workspace.users.find((candidate) => candidate.userId === userId || candidate.email === userId)
  const resolvedUserId = user?.userId ?? userId
  const resolvedEmail = user?.email?.toLowerCase()

  const directNodeIds = workspace.roles
    .filter((role) => role.userId === resolvedUserId || (resolvedEmail && role.userId === resolvedEmail))
    .map((role) => role.nodeId)
  const personalNodeId = user?.personalNodeId
  const rootIds = Array.from(new Set([...directNodeIds, ...(personalNodeId ? [personalNodeId] : [])]))
  return getDescendantNodeIds(rootIds, workspace.nodes)
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

export function getOrgSnapshot(): WorkspaceSnapshot {
  const db = readWorkspaceDb()
  const activeNodes = db.nodes.filter((node) => !node.isDeleted)
  const activeNodeIds = new Set(activeNodes.map((node) => node.id))

  return {
    users: db.users.map((user) => ({ ...user })),
    nodes: activeNodes.map((node) => ({ ...node, path: [...node.path] })),
    roles: db.roles
      .filter((role) => !role.isDeleted && activeNodeIds.has(role.nodeId))
      .map((role) => ({ ...role })),
    workItems: db.workItems
      .filter((item) => !item.isDeleted && activeNodeIds.has(item.ownerNodeId))
      .map((item) => ({ ...item })),
    authorities: (db.authorities ?? []).map((auth) => ({ ...auth })),
    mentions: (db.mentions ?? []).map((m) => ({ ...m })),
    activities: (db.activities ?? []).map((act) => ({ ...act })),
    files: (db.files ?? []).map((f) => ({ ...f })),
  }
}

export async function fetchNodeDetail(nodeId: number | string): Promise<WorkspaceSnapshot> {
  if (isServerDataSource()) {
    await fetchNodeDetailOnServer(nodeId)
  }
  return getOrgSnapshot()
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
            visibleWorkItems.reduce((total, item) => total + item.progress, 0) / visibleWorkItems.length,
          )
        : 0,
    myWorkItemCount: visibleWorkItems.filter((item) => item.ownerUserId === userId).length,
    teamPoolWorkItemCount: visibleWorkItems.filter((item) => item.ownerUserId !== userId).length,
    dueSoonWorkItemCount: visibleWorkItems.filter(isWorkItemDueSoon).length,
  }
}

export async function createTopNode(payload: CreateTopNodeRequest) {
  if (isServerDataSource()) {
    return createTopNodeOnServer(payload)
  }

  await delay()

  const db = readWorkspaceDb()
  const user = db.users.find((candidate) => candidate.userId === payload.userId.trim())
  const name = payload.name.trim()

  if (!user) {
    return {
      status: 'error' as const,
      message: '생성자를 찾을 수 없습니다.',
    }
  }

  if (!name) {
    return {
      status: 'error' as const,
      message: '조직 이름을 입력해야 합니다.',
    }
  }

  const newNodeId = db.counters.node
  const timestamp = nowIso()
  db.counters.node += 1

  db.nodes.push({
    id: newNodeId,
    nodeType: payload.nodeType,
    name,
    path: [newNodeId],
    createdAt: timestamp,
  })

  db.roles.push({
    id: db.counters.role,
    userId: user.userId,
    nodeId: newNodeId,
    roleName: payload.roleName,
    createdAt: timestamp,
  })
  db.counters.role += 1

  writeWorkspaceDb(db)

  return {
    status: 'success' as const,
    newNodeId,
  }
}

export async function createSubNode(payload: CreateSubNodeRequest) {
  if (isServerDataSource()) {
    return createSubNodeOnServer(payload)
  }

  await delay()

  const db = readWorkspaceDb()
  const parentNode = db.nodes.find((node) => node.id === payload.parentNodeId)
  const manager = getUserByEmail(payload.email, db.users)
  const name = payload.name.trim()

  if (!parentNode) {
    return {
      status: 'error' as const,
      message: '부모 노드를 찾을 수 없습니다.',
    }
  }

  if (!manager) {
    return {
      status: 'error' as const,
      message: '담당자 이메일에 해당하는 사용자가 없습니다.',
    }
  }

  if (!name) {
    return {
      status: 'error' as const,
      message: '하위 노드 이름을 입력해야 합니다.',
    }
  }

  const newNodeId = db.counters.node
  const timestamp = nowIso()
  db.counters.node += 1

  db.nodes.push({
    id: newNodeId,
    parentNodeId: payload.parentNodeId,
    nodeType: payload.nodeType,
    name,
    path: [...parentNode.path, newNodeId],
    createdAt: timestamp,
  })

  db.roles.push({
    id: db.counters.role,
    userId: manager.userId,
    nodeId: newNodeId,
    roleName: payload.roleName,
    createdAt: timestamp,
  })
  db.counters.role += 1

  writeWorkspaceDb(db)

  return {
    status: 'success' as const,
    newNodeId,
  }
}

export async function assignRoleToNode(payload: AssignRoleRequest) {
  if (isServerDataSource()) {
    return assignRoleOnServer(payload)
  }

  await delay()

  const db = readWorkspaceDb()
  const user = getUserByEmail(payload.email, db.users)
  const node = db.nodes.find((candidate) => candidate.id === payload.nodeId)

  if (!user) {
    return {
      status: 'error' as const,
      message: '권한을 부여할 이메일을 찾을 수 없습니다.',
    }
  }

  if (!node) {
    return {
      status: 'error' as const,
      message: '대상 노드를 찾을 수 없습니다.',
    }
  }

  const duplicatedRole = db.roles.find(
    (role) => role.userId === user.userId && role.nodeId === payload.nodeId && role.roleName === payload.roleName,
  )

  if (duplicatedRole) {
    return {
      status: 'error' as const,
      message: '같은 역할이 이미 부여되어 있습니다.',
    }
  }

  db.roles.push({
    id: db.counters.role,
    userId: user.userId,
    nodeId: payload.nodeId,
    roleName: payload.roleName,
    createdAt: nowIso(),
  })
  db.counters.role += 1

  writeWorkspaceDb(db)

  return {
    status: 'success' as const,
    newRoleId: db.counters.role - 1,
  }
}

export async function updateNode(payload: UpdateNodeRequest) {
  if (isServerDataSource()) {
    return updateNodeOnServer(payload)
  }

  await delay()

  const db = readWorkspaceDb()
  const node = db.nodes.find((candidate) => candidate.id === payload.nodeId)
  const name = payload.name?.trim()

  if (!node) {
    return {
      status: 'error' as const,
      message: '수정할 조직을 찾을 수 없습니다.',
    }
  }

  if (name !== undefined && !name) {
    return {
      status: 'error' as const,
      message: '조직 이름은 비워둘 수 없습니다.',
    }
  }

  if (name) {
    node.name = name
  }

  if (payload.nodeType) {
    node.nodeType = payload.nodeType
  }

  writeWorkspaceDb(db)

  return {
    status: 'success' as const,
  }
}

export async function updateRole(payload: UpdateRoleRequest) {
  if (isServerDataSource()) {
    return updateRoleOnServer(payload)
  }

  await delay()

  const db = readWorkspaceDb()
  const user = getUserByEmail(payload.email, db.users)
  const node = db.nodes.find((candidate) => candidate.id === payload.nodeId)

  if (!user) {
    return {
      status: 'error' as const,
      message: '권한을 변경할 사용자를 찾을 수 없습니다.',
    }
  }

  if (!node) {
    return {
      status: 'error' as const,
      message: '대상 조직을 찾을 수 없습니다.',
    }
  }

  const role = db.roles.find((candidate) => candidate.userId === user.userId && candidate.nodeId === payload.nodeId)

  if (!role) {
    return {
      status: 'error' as const,
      message: '변경할 권한이 없습니다. 먼저 권한을 추가해 주세요.',
    }
  }

  role.roleName = payload.roleName
  writeWorkspaceDb(db)

  return {
    status: 'success' as const,
  }
}
