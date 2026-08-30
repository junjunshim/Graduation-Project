import type {
  OrganizationNodeRecord,
  RoleAssignmentRecord,
  UserRecord,
  WorkItemRecord,
  WorkspaceDatabase,
} from '../model/types'
import { createConfiguredMockWorkspaceSeed } from './mockScenario.js'
import { ensureSessionUserExists } from './session.js'
import { isServerDataSource } from './workspaceMode.js'
import { notifyWorkspaceCacheUpdated } from './workspaceCacheEvents.js'

const DB_STORAGE_KEY = 'grad-client-mvp-db'
const SERVER_DB_STORAGE_KEY = 'grad-client-server-db'
const SERVER_DATASET_ID = 'server-workspace'
const SERVER_SEED_VERSION = 1

function hasStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

export function nowIso() {
  return new Date().toISOString()
}

function getDefaultTimestamp(offsetDays = 0) {
  const base = new Date('2026-03-01T09:00:00+09:00')
  base.setDate(base.getDate() + offsetDays)
  return base.toISOString()
}

function getMaxNumericSuffix(values: string[], prefix: string) {
  return values.reduce((maxValue, value) => {
    const normalized = value.trim().toUpperCase()

    if (!normalized.startsWith(prefix)) {
      return maxValue
    }

    const numeric = Number.parseInt(normalized.slice(prefix.length), 10)
    return Number.isFinite(numeric) ? Math.max(maxValue, numeric) : maxValue
  }, 0)
}

export function generateUserId(db: WorkspaceDatabase) {
  return `U-${getMaxNumericSuffix(db.users.map((user) => user.userId), 'U-') + 1}`
}

export function generateWorkItemId(workspace: Pick<WorkspaceDatabase, 'workItems'>) {
  return `WI-${getMaxNumericSuffix(workspace.workItems.map((item) => item.workItemId), 'WI-') + 1}`
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
  options: { allowExternalDataset?: boolean; fallback?: () => WorkspaceDatabase } = {},
): WorkspaceDatabase {
  const configuredMockSeed = options.allowExternalDataset ? null : createConfiguredMockWorkspaceSeed()
  const createFallback = options.fallback ?? createConfiguredMockWorkspaceSeed

  if (!raw || typeof raw !== 'object') {
    return createFallback()
  }

  const rawDb = raw as Record<string, unknown>
  const datasetId = String(rawDb.datasetId ?? '')
  const seedVersion = Number(rawDb.seedVersion)

  if (
    configuredMockSeed &&
    (datasetId !== configuredMockSeed.datasetId || seedVersion !== configuredMockSeed.seedVersion)
  ) {
    return createFallback()
  }

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
    const userId = String(rawUserId ?? (options.allowExternalDataset ? '' : `U-${index + 1}`)).trim()
    const email = String(item.email ?? '').trim().toLowerCase()
    const name = String(item.name ?? userId).trim()
    const password = String(item.password ?? item.password_hash ?? '')

    if (!userId || !name || (!email && !options.allowExternalDataset)) {
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
      ...(password ? { password } : {}),
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

    nodes.push({
      id,
      ...(parentNodeId && Number.isFinite(parentNodeId) ? { parentNodeId } : {}),
      nodeType: String(item.nodeType ?? item.node_type ?? 'TEAM') as OrganizationNodeRecord['nodeType'],
      name: String(item.name ?? `Node ${id}`),
      path: Array.isArray(item.path) ? item.path.map(Number).filter(Number.isFinite) : [],
      createdAt: String(item.createdAt ?? item.createAt ?? item.create_at ?? getDefaultTimestamp(index)),
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
    .map((entry, index) => {
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

      return {
        id: Number(item.id ?? item.assignment_id ?? index + 1),
        userId,
        nodeId,
        roleName: String(item.roleName ?? item.role_name ?? item.role ?? 'MEMBER') as RoleAssignmentRecord['roleName'],
        createdAt: String(item.createdAt ?? item.createAt ?? item.create_at ?? getDefaultTimestamp(index)),
      }
    })
    .filter((entry): entry is RoleAssignmentRecord => Boolean(entry))

  users.forEach((user) => {
    if (user.personalNodeId && nodeIds.has(user.personalNodeId)) {
      return
    }

    const personalRole = roles.find((role) => {
      if (role.userId !== user.userId || role.roleName !== 'ADMIN') {
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

    workItems.push({
      workItemId,
      ownerNodeId,
      ownerUserId,
      title: String(item.title ?? workItemId),
      description: String(item.description ?? ''),
      status: String(item.status ?? 'todo') as WorkItemRecord['status'],
      priority: Number(item.priority ?? 3),
      weight: Number(item.weight ?? 1),
      progress: Number(item.progress ?? 0),
      ...(startDate ? { startDate } : {}),
      ...(dueDate ? { dueDate } : {}),
      ...(parentWorkItemId ? { parentWorkItemId } : {}),
      createdAt: String(item.createdAt ?? item.createAt ?? item.create_at ?? getDefaultTimestamp(index)),
    })
  })

  workItems.forEach((item) => {
    if (item.parentWorkItemId && !workItemIds.has(item.parentWorkItemId)) {
      delete item.parentWorkItemId
    }
  })

  return {
    datasetId: options.allowExternalDataset
      ? datasetId || SERVER_DATASET_ID
      : configuredMockSeed?.datasetId ?? datasetId,
    seedVersion: options.allowExternalDataset
      ? Number.isFinite(seedVersion)
        ? seedVersion
        : SERVER_SEED_VERSION
      : configuredMockSeed?.seedVersion ?? seedVersion,
    users,
    nodes,
    roles,
    workItems,
    counters: {
      node: Math.max(0, ...nodes.map((node) => node.id)) + 1,
      role: Math.max(0, ...roles.map((role) => role.id)) + 1,
    },
  }
}

export function normalizeServerWorkspaceDb(raw: unknown): WorkspaceDatabase {
  return normalizeDb(raw, {
    allowExternalDataset: true,
    fallback: createEmptyServerWorkspace,
  })
}

export function readWorkspaceDb(): WorkspaceDatabase {
  if (isServerDataSource()) {
    return readServerWorkspaceDb()
  }

  if (!hasStorage()) {
    return createConfiguredMockWorkspaceSeed()
  }

  const raw = window.localStorage.getItem(DB_STORAGE_KEY)

  if (!raw) {
    const seededDb = createConfiguredMockWorkspaceSeed()
    window.localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(seededDb))
    ensureSessionUserExists(seededDb)
    return seededDb
  }

  try {
    const normalized = normalizeDb(JSON.parse(raw))
    const changed = ensureSeedData(normalized)
    const clearedInvalidSession = ensureSessionUserExists(normalized)
    const normalizedRaw = JSON.stringify(normalized)

    if (changed || clearedInvalidSession || normalizedRaw !== raw) {
      window.localStorage.setItem(DB_STORAGE_KEY, normalizedRaw)
    }

    return normalized
  } catch {
    const seededDb = createConfiguredMockWorkspaceSeed()
    window.localStorage.setItem(DB_STORAGE_KEY, JSON.stringify(seededDb))
    ensureSessionUserExists(seededDb)
    return seededDb
  }
}

export function writeWorkspaceDb(db: WorkspaceDatabase) {
  if (!hasStorage()) {
    return
  }

  window.localStorage.setItem(isServerDataSource() ? SERVER_DB_STORAGE_KEY : DB_STORAGE_KEY, JSON.stringify(db))
  notifyWorkspaceCacheUpdated()
}

export function readServerWorkspaceDb(): WorkspaceDatabase {
  if (!hasStorage()) {
    return createEmptyServerWorkspace()
  }

  const raw = window.localStorage.getItem(SERVER_DB_STORAGE_KEY)

  if (!raw) {
    return createEmptyServerWorkspace()
  }

  try {
    const normalized = normalizeServerWorkspaceDb(JSON.parse(raw))
    const normalizedRaw = JSON.stringify(normalized)

    if (normalizedRaw !== raw) {
      window.localStorage.setItem(SERVER_DB_STORAGE_KEY, normalizedRaw)
    }

    return normalized
  } catch {
    return createEmptyServerWorkspace()
  }
}

export function writeServerWorkspaceDb(db: WorkspaceDatabase) {
  if (!hasStorage()) {
    return
  }

  window.localStorage.setItem(SERVER_DB_STORAGE_KEY, JSON.stringify(db))
  notifyWorkspaceCacheUpdated()
}

export function clearServerWorkspaceDb() {
  if (!hasStorage()) {
    return
  }

  window.localStorage.removeItem(SERVER_DB_STORAGE_KEY)
  notifyWorkspaceCacheUpdated()
}

function ensureSeedData(db: WorkspaceDatabase) {
  const seedDb = createConfiguredMockWorkspaceSeed()
  let changed = false

  if (db.datasetId !== seedDb.datasetId || db.seedVersion !== seedDb.seedVersion) {
    db.datasetId = seedDb.datasetId
    db.seedVersion = seedDb.seedVersion
    changed = true
  }

  const userIds = new Set(db.users.map((user) => user.userId))
  const userEmails = new Set(db.users.map((user) => user.email.toLowerCase()))

  seedDb.users.forEach((user) => {
    if (userIds.has(user.userId) || userEmails.has(user.email.toLowerCase())) {
      return
    }

    db.users.push(user)
    userIds.add(user.userId)
    userEmails.add(user.email.toLowerCase())
    changed = true
  })

  const nodeIds = new Set(db.nodes.map((node) => node.id))

  seedDb.nodes.forEach((node) => {
    if (nodeIds.has(node.id)) {
      return
    }

    db.nodes.push(node)
    nodeIds.add(node.id)
    changed = true
  })

  const roleIds = new Set(db.roles.map((role) => role.id))

  seedDb.roles.forEach((role) => {
    if (roleIds.has(role.id)) {
      return
    }

    db.roles.push(role)
    roleIds.add(role.id)
    changed = true
  })

  const workItemIds = new Set(db.workItems.map((item) => item.workItemId))

  seedDb.workItems.forEach((item) => {
    if (workItemIds.has(item.workItemId)) {
      return
    }

    db.workItems.push(item)
    workItemIds.add(item.workItemId)
    changed = true
  })

  db.counters.node = Math.max(db.counters.node, seedDb.counters.node, Math.max(0, ...db.nodes.map((node) => node.id)) + 1)
  db.counters.role = Math.max(db.counters.role, seedDb.counters.role, Math.max(0, ...db.roles.map((role) => role.id)) + 1)

  return changed
}

export function delay(ms = 160) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}

export function getUserByEmail(email: string, users: UserRecord[]) {
  return users.find((user) => user.email.toLowerCase() === email.trim().toLowerCase())
}
