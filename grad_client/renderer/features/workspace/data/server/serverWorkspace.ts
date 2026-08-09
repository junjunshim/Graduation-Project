import type {
  AssignRoleRequest,
  CreateSubNodeRequest,
  CreateTopNodeRequest,
  CreateWorkItemRequest,
  NodeType,
  RoleName,
  SignInRequest,
  SignInResponse,
  SignUpRequest,
  UpdateNodeRequest,
  UpdateRoleRequest,
  UpdateWorkItemRequest,
  UserRecord,
  WorkItemStatus,
  WorkspaceDatabase,
} from '../../model/types'
import { apiRequest, clearServerSession, getServerSessionEmail, setServerSession } from './apiClient'
import { clearServerWorkspaceDb, readWorkspaceDb, writeServerWorkspaceDb } from '../localStore'
import { getCurrentSessionUserId, setCurrentSessionUserId } from '../session'

type ServerStatusResponse = {
  status: 'success' | 'error'
  message?: string
}

type ServerOperationError = {
  status: 'error'
  message: string
}

type ServerLoginResponse = ServerStatusResponse & {
  access_token?: string
  refresh_token?: string
}

type ServerContextResponse = ServerStatusResponse & {
  data?: ServerIntegratedItem[]
}

type ServerIntegratedItem = {
  type?: string
  id?: string | number
  node_id?: string | number
  node_type?: string
  parent_id?: string | number | null
  title?: string
  status?: string
  priority?: number
  weight?: number
  progress?: number
  description?: string
  owner_user_id?: string
  owner_user_email?: string
  start_date?: string
  due_date?: string
  extra_info?: string
  updated_at?: string
}

const SERVER_DATASET_ID = 'server-workspace'
const SERVER_SEED_VERSION = 1
const DEFAULT_SERVER_PASSWORD = ''

async function withServerOperationError<Result>(
  operation: () => Promise<Result>,
  fallbackMessage: string,
): Promise<Result | ServerOperationError> {
  try {
    return await operation()
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error && error.message ? error.message : fallbackMessage,
    }
  }
}

function nowIso() {
  return new Date().toISOString()
}

function toStringValue(value: unknown) {
  return value === undefined || value === null ? '' : String(value)
}

function toOptionalString(value: unknown) {
  const normalized = toStringValue(value).trim()
  return normalized ? normalized : undefined
}

function toNumberValue(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function getDisplayNameFromEmail(email: string) {
  const [name] = email.split('@')
  return name || email
}

function normalizeNodeType(value: unknown): NodeType {
  const normalized = toStringValue(value).toUpperCase()

  if (
    normalized === 'USER' ||
    normalized === 'COMPANY' ||
    normalized === 'DIVISION' ||
    normalized === 'DEPARTMENT' ||
    normalized === 'TEAM' ||
    normalized === 'PROJECT'
  ) {
    return normalized
  }

  return 'TEAM'
}

function normalizeRoleName(value: unknown): RoleName {
  const normalized = toStringValue(value).toUpperCase()

  if (normalized === 'ADMIN' || normalized === 'MANAGER' || normalized === 'MEMBER') {
    return normalized
  }

  return 'MEMBER'
}

function normalizeWorkItemStatus(value: unknown): WorkItemStatus {
  const normalized = toStringValue(value).trim().toLowerCase().replace('_', '-')

  if (normalized === 'in-progress' || normalized === 'doing') {
    return 'in-progress'
  }

  if (normalized === 'done' || normalized === 'end' || normalized === 'completed') {
    return 'done'
  }

  return 'todo'
}

function parseNodePath(value: unknown) {
  const raw = toStringValue(value)
  const matches = raw.match(/\d+/g)
  return matches ? matches.map(Number).filter(Number.isFinite) : []
}

function ensureUser(users: Map<string, UserRecord>, email: string) {
  const normalizedEmail = normalizeEmail(email)
  const existing = users.get(normalizedEmail)

  if (existing) {
    return existing
  }

  const user: UserRecord = {
    userId: normalizedEmail,
    email: normalizedEmail,
    name: getDisplayNameFromEmail(normalizedEmail),
    password: DEFAULT_SERVER_PASSWORD,
    createdAt: nowIso(),
  }

  users.set(normalizedEmail, user)
  return user
}

function getCurrentServerEmail() {
  const sessionUserId = getCurrentSessionUserId()
  return normalizeEmail(sessionUserId ?? getServerSessionEmail() ?? '')
}

function mergeServerUpdates(current: WorkspaceDatabase, updates: WorkspaceDatabase): WorkspaceDatabase {
  const nodesById = new Map(current.nodes.map((node) => [node.id, node]))
  const rolesById = new Map(current.roles.map((role) => [role.id, role]))
  const workItemsById = new Map(current.workItems.map((item) => [item.workItemId, item]))
  const usersById = new Map(current.users.map((user) => [user.userId, user]))

  updates.users.forEach((user) => usersById.set(user.userId, user))
  updates.nodes.forEach((node) => nodesById.set(node.id, node))
  updates.roles.forEach((role) => rolesById.set(role.id, role))
  updates.workItems.forEach((item) => workItemsById.set(item.workItemId, item))

  const nodes = Array.from(nodesById.values())
  const roles = Array.from(rolesById.values())

  return {
    ...current,
    users: Array.from(usersById.values()),
    nodes,
    roles,
    workItems: Array.from(workItemsById.values()),
    counters: {
      node: Math.max(0, ...nodes.map((node) => node.id)) + 1,
      role: Math.max(0, ...roles.map((role) => role.id)) + 1,
    },
  }
}

export function normalizeServerContext(items: ServerIntegratedItem[], currentEmail: string): WorkspaceDatabase {
  const timestamp = nowIso()
  const users = new Map<string, UserRecord>()
  const normalizedCurrentEmail = normalizeEmail(currentEmail)

  if (normalizedCurrentEmail) {
    ensureUser(users, normalizedCurrentEmail)
  }

  const nodes = items
    .filter((item) => item.type === 'NODE')
    .map((item) => {
      const id = toNumberValue(item.id ?? item.node_id, 0)
      const parentNodeId = toOptionalString(item.parent_id)
      const path = parseNodePath(item.extra_info)

      return {
        id,
        ...(parentNodeId ? { parentNodeId: Number(parentNodeId) } : {}),
        nodeType: normalizeNodeType(item.node_type),
        name: toOptionalString(item.title) ?? `Node ${id}`,
        path: path.length > 0 ? path : [id],
        createdAt: toOptionalString(item.updated_at) ?? timestamp,
      }
    })
    .filter((node) => node.id > 0)

  const roles = items
    .filter((item) => item.type === 'ROLE')
    .map((item, index) => {
      const email = normalizeEmail(toStringValue(item.title))
      const user = ensureUser(users, email || normalizedCurrentEmail || `server-user-${index + 1}`)
      const nodeId = toNumberValue(item.parent_id ?? item.node_id, 0)
      const roleName = normalizeRoleName(item.status ?? item.extra_info)

      if (roleName === 'ADMIN') {
        const node = nodes.find((candidate) => candidate.id === nodeId)

        if (node?.nodeType === 'USER') {
          user.personalNodeId = node.id
        }
      }

      return {
        id: toNumberValue(item.id, index + 1),
        userId: user.userId,
        nodeId,
        roleName,
        createdAt: toOptionalString(item.updated_at) ?? timestamp,
      }
    })
    .filter((role) => role.nodeId > 0)

  const currentUser = normalizedCurrentEmail ? ensureUser(users, normalizedCurrentEmail) : null
  const fallbackOwnerUserId = currentUser?.userId ?? Array.from(users.values())[0]?.userId ?? 'server-user'
  const workItems = items
    .filter((item) => item.type === 'WORK_ITEM')
    .map((item) => {
      const ownerEmail = normalizeEmail(item.owner_user_email ?? '')
      const ownerUser = ownerEmail ? ensureUser(users, ownerEmail) : null
      const workItemId = toStringValue(item.id).trim()
      const parentWorkItemId = toOptionalString(item.extra_info)

      return {
        workItemId,
        ownerNodeId: toNumberValue(item.parent_id, 0),
        ownerUserId: item.owner_user_id ?? ownerUser?.userId ?? fallbackOwnerUserId,
        title: toOptionalString(item.title) ?? workItemId,
        description: toOptionalString(item.description) ?? '',
        status: normalizeWorkItemStatus(item.status),
        priority: toNumberValue(item.priority, 3),
        weight: toNumberValue(item.weight, 1),
        progress: toNumberValue(item.progress, 0),
        ...(toOptionalString(item.start_date) ? { startDate: toOptionalString(item.start_date) } : {}),
        ...(toOptionalString(item.due_date) ? { dueDate: toOptionalString(item.due_date) } : {}),
        ...(parentWorkItemId ? { parentWorkItemId } : {}),
        createdAt: toOptionalString(item.updated_at) ?? timestamp,
      }
    })
    .filter((item) => item.workItemId && item.ownerNodeId > 0)

  return {
    datasetId: SERVER_DATASET_ID,
    seedVersion: SERVER_SEED_VERSION,
    users: Array.from(users.values()),
    nodes,
    roles,
    workItems,
    counters: {
      node: Math.max(0, ...nodes.map((node) => node.id)) + 1,
      role: Math.max(0, ...roles.map((role) => role.id)) + 1,
    },
  }
}

export function getCurrentServerUser(snapshot?: Pick<WorkspaceDatabase, 'users'>) {
  const email = getCurrentServerEmail()

  if (!email) {
    return null
  }

  const users = snapshot?.users ?? readWorkspaceDb().users
  return users.find((user) => user.userId === email || user.email === email) ?? null
}

export async function loadServerWorkspace(email = getCurrentServerEmail()) {
  const response = await apiRequest<ServerContextResponse>('/context/init')

  if (response.status === 'error') {
    throw new Error(response.message ?? '워크스페이스를 불러오지 못했습니다.')
  }

  const db = normalizeServerContext(response.data ?? [], email)
  writeServerWorkspaceDb(db)
  return db
}

export async function syncServerWorkspace(lastSyncedAt = '1970-01-01 00:00:00') {
  const response = await apiRequest<ServerContextResponse>(
    `/context/sync?last_synced_at=${encodeURIComponent(lastSyncedAt)}`,
  )

  if (response.status === 'error') {
    throw new Error(response.message ?? '워크스페이스 동기화에 실패했습니다.')
  }

  const merged = mergeServerUpdates(readWorkspaceDb(), normalizeServerContext(response.data ?? [], getCurrentServerEmail()))
  writeServerWorkspaceDb(merged)
  return merged
}

export async function signInServerUser(payload: SignInRequest): Promise<SignInResponse> {
  const email = normalizeEmail(payload.email)
  let shouldRollbackSession = false

  if (!email || !payload.password.trim()) {
    return {
      status: 'error',
      message: '이메일과 비밀번호를 입력해 주세요.',
    }
  }

  try {
    const response = await apiRequest<ServerLoginResponse>('/users/login', {
      method: 'POST',
      body: {
        email,
        password: payload.password,
      },
      includeToken: false,
    })

    if (response.status === 'error' || !response.access_token || !response.refresh_token) {
      return {
        status: 'error',
        message: response.message ?? '로그인에 실패했습니다.',
      }
    }

    shouldRollbackSession = true
    setServerSession({
      accessToken: response.access_token,
      refreshToken: response.refresh_token,
      email,
    })
    setCurrentSessionUserId(email)
    await loadServerWorkspace(email)

    const user = getCurrentServerUser() ?? ensureUser(new Map(), email)

    return {
      status: 'success',
      user,
    }
  } catch (error) {
    if (shouldRollbackSession) {
      clearServerSession()
      clearServerWorkspaceDb()
      setCurrentSessionUserId(null)
    }

    return {
      status: 'error',
      message: error instanceof Error ? error.message : '서버 로그인에 실패했습니다.',
    }
  }
}

export async function signUpServerUser(payload: SignUpRequest) {
  try {
    const response = await apiRequest<ServerStatusResponse>('/users', {
      method: 'POST',
      body: {
        user_id: payload.userId,
        email: payload.email,
        name: payload.name,
        password: payload.password,
      },
      includeToken: false,
    })

    if (response.status === 'error') {
      return {
        status: 'error' as const,
        message: response.message ?? '회원가입에 실패했습니다.',
      }
    }

    return signInServerUser({
      email: payload.email,
      password: payload.password,
    })
  } catch (error) {
    return {
      status: 'error' as const,
      message: error instanceof Error ? error.message : '서버 회원가입에 실패했습니다.',
    }
  }
}

export function signOutServerUser() {
  clearServerSession()
  clearServerWorkspaceDb()
  setCurrentSessionUserId(null)
}

export async function createTopNodeOnServer(payload: CreateTopNodeRequest) {
  return withServerOperationError(async () => {
    const response = await apiRequest<ServerStatusResponse>('/org/topNodes', {
      method: 'POST',
      body: {
        node_type: payload.nodeType,
        name: payload.name,
        role_name: payload.roleName,
      },
    })

    if (response.status === 'error') {
      return { status: 'error' as const, message: response.message ?? '공유 공간을 만들지 못했습니다.' }
    }

    await loadServerWorkspace()
    return { status: 'success' as const, newNodeId: 0 }
  }, '공유 공간을 만들지 못했습니다.')
}

export async function createSubNodeOnServer(payload: CreateSubNodeRequest) {
  return withServerOperationError(async () => {
    const response = await apiRequest<ServerStatusResponse>('/org/subNodes', {
      method: 'POST',
      body: {
        node_type: payload.nodeType,
        parent_node_id: payload.parentNodeId,
        name: payload.name,
        email: payload.email,
        role_name: payload.roleName,
      },
    })

    if (response.status === 'error') {
      return { status: 'error' as const, message: response.message ?? '하위 조직을 추가하지 못했습니다.' }
    }

    await loadServerWorkspace()
    return { status: 'success' as const, newNodeId: 0 }
  }, '하위 조직을 추가하지 못했습니다.')
}

export async function assignRoleOnServer(payload: AssignRoleRequest) {
  return withServerOperationError(async () => {
    const response = await apiRequest<ServerStatusResponse>('/roles', {
      method: 'POST',
      body: {
        email: payload.email,
        node_id: payload.nodeId,
        role_name: payload.roleName,
      },
    })

    if (response.status === 'error') {
      return { status: 'error' as const, message: response.message ?? '권한을 추가하지 못했습니다.' }
    }

    await loadServerWorkspace()
    return { status: 'success' as const, newRoleId: 0 }
  }, '권한을 추가하지 못했습니다.')
}

export async function updateNodeOnServer(payload: UpdateNodeRequest) {
  return withServerOperationError(async () => {
    const response = await apiRequest<ServerStatusResponse>('/org/nodes', {
      method: 'PATCH',
      body: {
        node_id: payload.nodeId,
        ...(payload.name !== undefined ? { name: payload.name } : {}),
        ...(payload.nodeType !== undefined ? { node_type: payload.nodeType } : {}),
      },
    })

    if (response.status === 'error') {
      return { status: 'error' as const, message: response.message ?? '조직을 수정하지 못했습니다.' }
    }

    await loadServerWorkspace()
    return { status: 'success' as const }
  }, '조직을 수정하지 못했습니다.')
}

export async function updateRoleOnServer(payload: UpdateRoleRequest) {
  return withServerOperationError(async () => {
    const response = await apiRequest<ServerStatusResponse>('/roles', {
      method: 'PATCH',
      body: {
        email: payload.email,
        node_id: payload.nodeId,
        role_name: payload.roleName,
      },
    })

    if (response.status === 'error') {
      return { status: 'error' as const, message: response.message ?? '권한을 변경하지 못했습니다.' }
    }

    await loadServerWorkspace()
    return { status: 'success' as const }
  }, '권한을 변경하지 못했습니다.')
}

export async function createWorkItemOnServer(payload: CreateWorkItemRequest) {
  return withServerOperationError(async () => {
    const ownerUser = readWorkspaceDb().users.find((user) => user.userId === payload.ownerUserId)
    const ownerEmail = ownerUser?.email || payload.ownerUserId

    const response = await apiRequest<ServerStatusResponse>('/workItems', {
      method: 'POST',
      body: {
        work_item_id: payload.workItemId,
        owner_node_id: payload.ownerNodeId,
        owner_user_email: ownerEmail,
        title: payload.title,
        parent_work_item_id: payload.parentWorkItemId ?? '',
        description: payload.description ?? '',
        status: payload.status ?? 'todo',
        priority: payload.priority ?? 3,
        weight: payload.weight ?? 1,
        progress: payload.progress ?? 0,
        start_date: payload.startDate ?? '',
        due_date: payload.dueDate ?? '',
      },
    })

    if (response.status === 'error') {
      return { status: 'error' as const, message: response.message ?? '업무를 생성하지 못했습니다.' }
    }

    await loadServerWorkspace()
    return { status: 'success' as const, workItemId: payload.workItemId }
  }, '업무를 생성하지 못했습니다.')
}

export async function updateWorkItemOnServer(payload: UpdateWorkItemRequest) {
  return withServerOperationError(async () => {
    const response = await apiRequest<ServerStatusResponse>('/workItems', {
      method: 'PATCH',
      body: {
        work_item_id: payload.workItemId,
        ...(payload.title !== undefined ? { title: payload.title } : {}),
        ...(payload.description !== undefined ? { description: payload.description } : {}),
        ...(payload.status !== undefined ? { status: payload.status } : {}),
        ...(payload.priority !== undefined ? { priority: payload.priority } : {}),
        ...(payload.weight !== undefined ? { weight: payload.weight } : {}),
        ...(payload.progress !== undefined ? { progress: payload.progress } : {}),
        ...(payload.startDate !== undefined ? { start_date: payload.startDate } : {}),
        ...(payload.dueDate !== undefined ? { due_date: payload.dueDate } : {}),
      },
    })

    if (response.status === 'error') {
      return { status: 'error' as const, message: response.message ?? '업무를 수정하지 못했습니다.' }
    }

    await loadServerWorkspace()
    return { status: 'success' as const, workItemId: payload.workItemId }
  }, '업무를 수정하지 못했습니다.')
}
