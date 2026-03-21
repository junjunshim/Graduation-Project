import type {
  AssignRoleRequest,
  CreateSubNodeRequest,
  CreateTopNodeRequest,
  OrganizationNodeRecord,
  WorkspaceSnapshot,
  WorkspaceSummary,
} from '../model/types'
import { delay, getUserByEmail, nowIso, readWorkspaceDb, writeWorkspaceDb } from './localStore'

function getDescendantNodeIds(rootIds: number[], nodes: OrganizationNodeRecord[]) {
  const visited = new Set<number>()
  const queue = [...rootIds]

  while (queue.length > 0) {
    const currentId = queue.shift()

    if (!currentId || visited.has(currentId)) {
      continue
    }

    visited.add(currentId)

    nodes
      .filter((node) => node.parentNodeId === currentId)
      .forEach((node) => {
        if (!visited.has(node.id)) {
          queue.push(node.id)
        }
      })
  }

  return Array.from(visited)
}

export function getAccessibleNodeIdsForUser(userId: string) {
  const db = readWorkspaceDb()
  const directNodeIds = db.roles.filter((role) => role.userId === userId).map((role) => role.nodeId)
  const personalNodeId = db.users.find((user) => user.userId === userId)?.personalNodeId
  const rootIds = Array.from(new Set([...directNodeIds, ...(personalNodeId ? [personalNodeId] : [])]))
  return getDescendantNodeIds(rootIds, db.nodes)
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

  return {
    users: db.users.map((user) => ({ ...user })),
    nodes: db.nodes.map((node) => ({ ...node, path: [...node.path] })),
    roles: db.roles.map((role) => ({ ...role })),
    workItems: db.workItems.map((item) => ({ ...item })),
  }
}

export function getWorkspaceSummary(userId?: string): WorkspaceSummary {
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
    }
  }

  const db = readWorkspaceDb()
  const visibleNodeIds = getAccessibleNodeIdsForUser(userId)
  const visibleWorkItems = db.workItems.filter((item) => visibleNodeIds.includes(item.ownerNodeId))
  const visibleNodes = db.nodes.filter((node) => visibleNodeIds.includes(node.id))

  return {
    nodeCount: visibleNodes.length,
    workItemCount: visibleWorkItems.length,
    roleCount: db.roles.filter((role) => role.userId === userId).length,
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
  }
}

export async function createTopNode(payload: CreateTopNodeRequest) {
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
