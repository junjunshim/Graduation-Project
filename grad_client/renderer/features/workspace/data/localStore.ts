import { resolveRoleAssignments } from '../model/roleDefinitions.js'
import type {
  OrganizationNodeRecord,
  RoleAssignmentRecord,
  UserRecord,
  WorkItemRecord,
  WorkspaceDatabase,
} from '../model/types'
import { notifyWorkspaceCacheUpdated } from './workspaceCacheEvents.js'

/** 서버에서 내려받은 컨텍스트를 담아 두는 로컬 캐시 키 */
const SERVER_DB_STORAGE_KEY = 'grad-client-server-db'
const SERVER_DATASET_ID = 'server-workspace'
const SERVER_SEED_VERSION = 1

function hasStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function getDefaultTimestamp(offsetDays = 0) {
  const base = new Date('2026-03-01T09:00:00+09:00')
  base.setDate(base.getDate() + offsetDays)
  return base.toISOString()
}

function computePath(nodeId: number, nodes: OrganizationNodeRecord[], trail = new Set<number>()): number[] {
  if (trail.has(nodeId)) {
    return [nodeId]
  }

  const node = nodes.find((candidate) => candidate.id === nodeId)

  if (!node) {
    return [nodeId]
  }

  if (node.path.length > 0) {
    return node.path
  }

  if (!node.parentNodeId) {
    return [node.id]
  }

  trail.add(nodeId)
  return [...computePath(node.parentNodeId, nodes, trail), node.id]
}

function createEmptyServerWorkspace(): WorkspaceDatabase {
  return {
    datasetId: SERVER_DATASET_ID,
    seedVersion: SERVER_SEED_VERSION,
    users: [],
    nodes: [],
    roles: [],
    workItems: [],
    counters: {
      node: 1,
      role: 1,
    },
  }
}

function normalizeDb(
  raw: unknown,
  options: { fallback?: () => WorkspaceDatabase } = {},
): WorkspaceDatabase {
  const createFallback = options.fallback ?? createEmptyServerWorkspace

  if (!raw || typeof raw !== 'object') {
    return createFallback()
  }

  const rawDb = raw as Record<string, unknown>
  const datasetId = String(rawDb.datasetId ?? '')
  const seedVersion = Number(rawDb.seedVersion)

  if (
    !Array.isArray(rawDb.users) ||
    !Array.isArray(rawDb.nodes) ||
    !Array.isArray(rawDb.roles) ||
    !Array.isArray(rawDb.workItems)
  ) {
    return createFallback()
  }

  const users: UserRecord[] = []

  rawDb.users.forEach((entry, index) => {
    const item = entry as Record<string, unknown>
    const rawUserId = item.userId ?? item.user_id
    const userId = String(rawUserId ?? '').trim()
    const email = String(item.email ?? '').trim().toLowerCase()
    const name = String(item.name ?? userId).trim()

    if (!userId || !name || !email) {
      return
    }

    const personalNodeId =
      item.personalNodeId !== undefined || item.personal_node_id !== undefined
        ? Number(item.personalNodeId ?? item.personal_node_id)
        : undefined

    users.push({
      userId,
      email,
      name,
      ...(Number.isFinite(personalNodeId) ? { personalNodeId } : {}),
      createdAt: String(item.createdAt ?? item.createAt ?? item.create_at ?? getDefaultTimestamp(index)),
    })
  })

  const nodes: OrganizationNodeRecord[] = []

  rawDb.nodes.forEach((entry, index) => {
    const item = entry as Record<string, unknown>
    const id = Number(item.id ?? item.nodeId ?? item.node_id)
    const parentNodeId =
      item.parentNodeId !== undefined || item.parent_node_id !== undefined
        ? Number(item.parentNodeId ?? item.parent_node_id)
        : undefined

    if (!Number.isFinite(id)) {
      return
    }

    const isDeleted =
      typeof item.isDeleted === 'boolean'
        ? item.isDeleted
        : typeof item.is_deleted === 'boolean'
          ? item.is_deleted
          : undefined
    const updatedAt =
      typeof item.updatedAt === 'string'
        ? item.updatedAt
        : typeof item.updated_at === 'string'
          ? item.updated_at
          : undefined

    nodes.push({
      id,
      ...(parentNodeId && Number.isFinite(parentNodeId) ? { parentNodeId } : {}),
      nodeType: String(item.nodeType ?? item.node_type ?? 'TEAM') as OrganizationNodeRecord['nodeType'],
      name: String(item.name ?? `Node ${id}`),
      path: Array.isArray(item.path) ? item.path.map(Number).filter(Number.isFinite) : [],
      ...(isDeleted !== undefined ? { isDeleted } : {}),
      createdAt: String(item.createdAt ?? item.createAt ?? item.create_at ?? getDefaultTimestamp(index)),
      ...(updatedAt ? { updatedAt } : {}),
    })
  })

  nodes.forEach((node) => {
    node.path = node.path.length > 0 ? node.path : computePath(node.id, nodes)
  })

  const userByEmail = new Map(
    users.filter((user) => Boolean(user.email)).map((user) => [user.email.toLowerCase(), user]),
  )
  const userById = new Map(users.map((user) => [user.userId, user]))
  const nodeIds = new Set(nodes.map((node) => node.id))

  const roles: RoleAssignmentRecord[] = rawDb.roles
    .map((entry, index): RoleAssignmentRecord | null => {
      const item = entry as Record<string, unknown>
      const nodeId = Number(item.nodeId ?? item.node_id)
      const userId =
        typeof item.userId === 'string'
          ? item.userId
          : typeof item.user_id === 'string'
            ? item.user_id
            : userByEmail.get(String(item.email ?? '').trim().toLowerCase())?.userId

      if (!userId || !nodeIds.has(nodeId) || !userById.has(userId)) {
        return null
      }

      const isDeleted =
        typeof item.isDeleted === 'boolean'
          ? item.isDeleted
          : typeof item.is_deleted === 'boolean'
            ? item.is_deleted
            : undefined
      const updatedAt =
        typeof item.updatedAt === 'string'
          ? item.updatedAt
          : typeof item.updated_at === 'string'
            ? item.updated_at
            : undefined

      return {
        id: Number(item.id ?? item.assignment_id ?? index + 1),
        userId,
        nodeId,
        roleId: Number(item.roleId ?? item.role_id) || undefined,
        isTopRole: Boolean(item.isTopRole ?? item.is_top_role),
        roleName: String(item.roleName ?? item.role_name ?? item.role ?? 'MEMBER') as RoleAssignmentRecord['roleName'],
        ...(isDeleted !== undefined ? { isDeleted } : {}),
        createdAt: String(item.createdAt ?? item.createAt ?? item.create_at ?? getDefaultTimestamp(index)),
        ...(updatedAt ? { updatedAt } : {}),
      }
    })
    .filter((role): role is RoleAssignmentRecord => role !== null)

  users.forEach((user) => {
    const personalRole = roles.find((role) => {
      if (role.userId !== user.userId || !role.isTopRole) {
        return false
      }

      const node = nodes.find((candidate) => candidate.id === role.nodeId)
      return node?.nodeType === 'USER'
    })

    if (personalRole) {
      user.personalNodeId = personalRole.nodeId
    }
  })

  const workItemIds = new Set<string>()
  const workItems: WorkItemRecord[] = []

  rawDb.workItems.forEach((entry, index) => {
    const item = entry as Record<string, unknown>
    const workItemId = String(item.workItemId ?? item.work_item_id ?? '')
    const displayId = Number(item.displayId ?? item.display_id)
    const ownerNodeId = Number(item.ownerNodeId ?? item.owner_node_id)
    const ownerUserId = String(item.ownerUserId ?? item.owner_user_id ?? '')

    if (!workItemId || !nodeIds.has(ownerNodeId) || !userById.has(ownerUserId)) {
      return
    }

    workItemIds.add(workItemId)

    const startDate =
      typeof item.startDate === 'string'
        ? item.startDate
        : typeof item.start_date === 'string'
          ? item.start_date
          : undefined

    const dueDate =
      typeof item.dueDate === 'string'
        ? item.dueDate
        : typeof item.due_date === 'string'
          ? item.due_date
          : undefined

    const parentWorkItemId =
      typeof item.parentWorkItemId === 'string'
        ? item.parentWorkItemId
        : typeof item.parent_work_item_id === 'string'
          ? item.parent_work_item_id
          : undefined
    const category = typeof item.category === 'string' ? item.category.trim() : undefined
    const hidden = typeof item.hidden === 'boolean' ? item.hidden : undefined
    const commentCount = Number(item.commentCount ?? item.comment_count)
    const isDeleted =
      typeof item.isDeleted === 'boolean'
        ? item.isDeleted
        : typeof item.is_deleted === 'boolean'
          ? item.is_deleted
          : undefined
    const updatedAt =
      typeof item.updatedAt === 'string'
        ? item.updatedAt
        : typeof item.updated_at === 'string'
          ? item.updated_at
          : undefined

    workItems.push({
      workItemId,
      ...(Number.isInteger(displayId) && displayId > 0 ? { displayId } : {}),
      ownerNodeId,
      ownerUserId,
      title: String(item.title ?? workItemId),
      description: String(item.description ?? ''),
      ...(category ? { category } : {}),
      status: String(item.status ?? 'todo') as WorkItemRecord['status'],
      priority: Number(item.priority ?? 3),
      ...(hidden !== undefined ? { hidden } : {}),
      weight: Number(item.weight ?? 0),
      progress: Number(item.progress ?? 0),
      computedProgress: Number(item.computedProgress ?? item.progress ?? 0),
      ...(Number.isFinite(commentCount) && commentCount >= 0 ? { commentCount } : {}),
      ...(isDeleted !== undefined ? { isDeleted } : {}),
      ...(startDate ? { startDate } : {}),
      ...(dueDate ? { dueDate } : {}),
      ...(parentWorkItemId ? { parentWorkItemId } : {}),
      createdAt: String(item.createdAt ?? item.createAt ?? item.create_at ?? getDefaultTimestamp(index)),
      ...(updatedAt ? { updatedAt } : {}),
    })
  })

  workItems.forEach((item) => {
    if (item.parentWorkItemId && !workItemIds.has(item.parentWorkItemId)) {
      delete item.parentWorkItemId
    }
  })

  const authorities = Array.isArray(rawDb.authorities) ? rawDb.authorities : []
  const mentions = Array.isArray(rawDb.mentions) ? rawDb.mentions : []
  const activities = Array.isArray(rawDb.activities) ? rawDb.activities : []
  const files = Array.isArray(rawDb.files) ? rawDb.files : []

  return {
    datasetId: datasetId || SERVER_DATASET_ID,
    seedVersion: Number.isFinite(seedVersion) ? seedVersion : SERVER_SEED_VERSION,
    users,
    nodes,
    roles: resolveRoleAssignments(roles, authorities as NonNullable<WorkspaceDatabase['authorities']>),
    workItems,
    authorities: authorities as WorkspaceDatabase['authorities'],
    mentions: mentions as WorkspaceDatabase['mentions'],
    activities: activities as WorkspaceDatabase['activities'],
    files: files as WorkspaceDatabase['files'],
    counters: {
      node: Math.max(0, ...nodes.map((node) => node.id)) + 1,
      role: Math.max(0, ...roles.map((role) => role.id)) + 1,
    },
  }
}

export function normalizeServerWorkspaceDb(raw: unknown): WorkspaceDatabase {
  return normalizeDb(raw, { fallback: createEmptyServerWorkspace })
}

// In-memory cache to eliminate repetitive, expensive JSON.parse / JSON.stringify calls
let inMemoryServerDb: WorkspaceDatabase | null = null

/** 서버 컨텍스트를 로컬에 캐시한 워크스페이스 DB */
export function readWorkspaceDb(): WorkspaceDatabase {
  if (inMemoryServerDb) {
    return inMemoryServerDb
  }

  if (!hasStorage()) {
    inMemoryServerDb = createEmptyServerWorkspace()
    return inMemoryServerDb
  }

  const raw = window.localStorage.getItem(SERVER_DB_STORAGE_KEY)

  if (!raw) {
    inMemoryServerDb = createEmptyServerWorkspace()
    return inMemoryServerDb
  }

  try {
    const normalized = normalizeServerWorkspaceDb(JSON.parse(raw))
    inMemoryServerDb = normalized
    return normalized
  } catch {
    inMemoryServerDb = createEmptyServerWorkspace()
    return inMemoryServerDb
  }
}

export function writeServerWorkspaceDb(db: WorkspaceDatabase) {
  inMemoryServerDb = db
  if (!hasStorage()) {
    return
  }

  window.localStorage.setItem(SERVER_DB_STORAGE_KEY, JSON.stringify(db))
  notifyWorkspaceCacheUpdated()
}

export function clearServerWorkspaceDb() {
  inMemoryServerDb = null
  if (!hasStorage()) {
    return
  }

  window.localStorage.removeItem(SERVER_DB_STORAGE_KEY)
  notifyWorkspaceCacheUpdated()
}
