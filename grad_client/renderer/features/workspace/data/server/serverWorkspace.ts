import type {
  AssignRoleRequest,
  CreateSubNodeRequest,
  CreateTopNodeRequest,
  CreateWorkItemRequest,
  SignInRequest,
  SignInResponse,
  SignUpRequest,
  UpdateNodeRequest,
  UpdateRoleRequest,
  UpdateWorkItemRequest,
  UserRecord,
  WorkspaceDatabase,
} from '../../model/types'
import {
  apiRequest,
  clearServerSession,
  getServerSessionEmail,
  hasServerSession,
  setServerSession,
  type ApiRequestOptions,
} from './apiClient'
import {
  getServerLoginTokens,
  isServerStatusResponse,
  parseServerContextItems,
  type ServerContextResponse,
  type ServerLoginResponse,
} from './apiTypes'
import { normalizeServerContext } from './contextAdapter'
import { clearServerWorkspaceDb, readWorkspaceDb, writeServerWorkspaceDb } from '../localStore'
import { setCurrentSessionUserId } from '../session'
import { notifyWorkspaceCacheRefreshFailed } from '../workspaceCacheEvents'

type ServerOperationError = {
  status: 'error'
  message: string
}

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

async function requestServerStatus(path: string, options?: ApiRequestOptions) {
  const response = await apiRequest<unknown>(path, options)

  if (!isServerStatusResponse(response)) {
    throw new Error('서버 응답 형식이 올바르지 않습니다.')
  }

  return response
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

async function refreshWorkspaceAfterCommittedMutation() {
  try {
    await loadServerWorkspace()
  } catch {
    notifyWorkspaceCacheRefreshFailed(
      '변경은 서버에 반영되었지만 최신 데이터를 다시 불러오지 못했습니다. 같은 변경을 다시 제출하지 말고 “다시 시도”로 데이터를 새로고침해 주세요.',
    )
  }
}

function createServerSessionUser(email: string): UserRecord {
  const [name] = email.split('@')
  return {
    userId: email,
    email,
    name: name || email,
    createdAt: new Date().toISOString(),
  }
}

function getCurrentServerEmail() {
  if (!hasServerSession()) {
    return ''
  }

  return normalizeEmail(getServerSessionEmail() ?? '')
}

function mergeServerUpdates(current: WorkspaceDatabase, updates: WorkspaceDatabase): WorkspaceDatabase {
  const nodesById = new Map(current.nodes.map((node) => [node.id, node]))
  const rolesById = new Map(current.roles.map((role) => [role.id, role]))
  const workItemsById = new Map(current.workItems.map((item) => [item.workItemId, item]))
  const usersById = new Map(current.users.map((user) => [user.userId, user]))
  const authoritiesById = new Map((current.authorities ?? []).map((auth) => [auth.id, auth]))
  const mentionsById = new Map((current.mentions ?? []).map((m) => [m.id, m]))
  const activitiesById = new Map((current.activities ?? []).map((act) => [act.id, act]))
  const filesById = new Map((current.files ?? []).map((f) => [f.id, f]))

  updates.users.forEach((user) => usersById.set(user.userId, user))
  updates.nodes.forEach((node) => nodesById.set(node.id, node))
  updates.roles.forEach((role) => rolesById.set(role.id, role))
  updates.workItems.forEach((item) => workItemsById.set(item.workItemId, item))
  ;(updates.authorities ?? []).forEach((auth) => authoritiesById.set(auth.id, auth))
  ;(updates.mentions ?? []).forEach((m) => mentionsById.set(m.id, m))
  ;(updates.activities ?? []).forEach((act) => activitiesById.set(act.id, act))
  ;(updates.files ?? []).forEach((f) => filesById.set(f.id, f))

  const nodes = Array.from(nodesById.values())
  const roles = Array.from(rolesById.values())

  return {
    ...current,
    users: Array.from(usersById.values()),
    nodes,
    roles,
    workItems: Array.from(workItemsById.values()),
    authorities: Array.from(authoritiesById.values()),
    mentions: Array.from(mentionsById.values()),
    activities: Array.from(activitiesById.values()),
    files: Array.from(filesById.values()),
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
  const response = await apiRequest<unknown>('/context/init')

  if (!isServerStatusResponse(response)) {
    throw new Error('서버 컨텍스트 응답 형식이 올바르지 않습니다.')
  }

  if (response.status === 'error') {
    throw new Error(response.message ?? '워크스페이스를 불러오지 못했습니다.')
  }

  const items = parseServerContextItems((response as ServerContextResponse).data)
  const { workspace: db, issues } = normalizeServerContext(items, email)

  if (issues.length > 0) {
    console.warn('[WorkspaceAdapter] 일부 컨텍스트 항목 정규화 이슈:', issues)
  }

  writeServerWorkspaceDb(db)
  return db
}

export async function syncServerWorkspace(lastSyncedAt = '1970-01-01 00:00:00') {
  const response = await apiRequest<unknown>(
    `/context/sync?last_synced_at=${encodeURIComponent(lastSyncedAt)}`,
  )

  if (!isServerStatusResponse(response)) {
    throw new Error('서버 동기화 응답 형식이 올바르지 않습니다.')
  }

  if (response.status === 'error') {
    throw new Error(response.message ?? '워크스페이스 동기화에 실패했습니다.')
  }

  const items = parseServerContextItems((response as ServerContextResponse).data)
  const current = readWorkspaceDb()
  const { workspace: normalized, issues } = normalizeServerContext(
    items,
    getCurrentServerEmail(),
    { referenceWorkspace: current },
  )

  if (issues.length > 0) {
    console.warn('[WorkspaceAdapter] 일부 동기화 항목 정규화 이슈:', issues)
  }

  const merged = mergeServerUpdates(current, normalized)
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
    const response = (await requestServerStatus('/users/login', {
      method: 'POST',
      body: {
        email,
        password: payload.password,
      },
      includeToken: false,
    })) as ServerLoginResponse
    const tokens = getServerLoginTokens(response)

    if (!tokens) {
      return {
        status: 'error',
        message:
          response.status === 'error'
            ? response.message ?? '로그인에 실패했습니다.'
            : '서버 로그인 응답에 인증 토큰이 누락되었습니다.',
      }
    }

    shouldRollbackSession = true
    setServerSession({
      ...tokens,
      email,
    })
    setCurrentSessionUserId(email)
    await loadServerWorkspace(email)

    const user = getCurrentServerUser() ?? createServerSessionUser(email)

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
  const email = normalizeEmail(payload.email)

  try {
    const response = await requestServerStatus('/users', {
      method: 'POST',
      body: {
        user_id: payload.userId.trim(),
        email,
        name: payload.name.trim(),
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

    const signInResponse = await signInServerUser({
      email,
      password: payload.password,
    })

    if (signInResponse.status === 'error') {
      return {
        status: 'error' as const,
        accountCreated: true as const,
        message:
          '계정 생성은 완료되었지만 자동 로그인에 실패했습니다. 가입을 다시 시도하지 말고 생성한 계정으로 로그인해 주세요.',
      }
    }

    return signInResponse
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
    const response = await requestServerStatus('/org/topNodes', {
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

    await refreshWorkspaceAfterCommittedMutation()
    return { status: 'success' as const, newNodeId: 0 }
  }, '공유 공간을 만들지 못했습니다.')
}

export async function createSubNodeOnServer(payload: CreateSubNodeRequest) {
  return withServerOperationError(async () => {
    const response = await requestServerStatus('/org/subNodes', {
      method: 'POST',
      body: {
        node_type: payload.nodeType,
        parent_node_id: payload.parentNodeId,
        name: payload.name,
        email: normalizeEmail(payload.email),
        role_name: payload.roleName,
      },
    })

    if (response.status === 'error') {
      return { status: 'error' as const, message: response.message ?? '하위 조직을 추가하지 못했습니다.' }
    }

    await refreshWorkspaceAfterCommittedMutation()
    return { status: 'success' as const, newNodeId: 0 }
  }, '하위 조직을 추가하지 못했습니다.')
}

export async function assignRoleOnServer(payload: AssignRoleRequest) {
  return withServerOperationError(async () => {
    const response = await requestServerStatus('/roles', {
      method: 'POST',
      body: {
        email: normalizeEmail(payload.email),
        node_id: payload.nodeId,
        role_name: payload.roleName,
      },
    })

    if (response.status === 'error') {
      return { status: 'error' as const, message: response.message ?? '권한을 추가하지 못했습니다.' }
    }

    await refreshWorkspaceAfterCommittedMutation()
    return { status: 'success' as const, newRoleId: 0 }
  }, '권한을 추가하지 못했습니다.')
}

export async function updateNodeOnServer(payload: UpdateNodeRequest) {
  return withServerOperationError(async () => {
    const response = await requestServerStatus('/org/nodes', {
      method: 'PATCH',
      body: {
        node_id: payload.nodeId,
        name: payload.name,
        node_type: payload.nodeType,
      },
    })

    if (response.status === 'error') {
      return { status: 'error' as const, message: response.message ?? '조직을 수정하지 못했습니다.' }
    }

    await refreshWorkspaceAfterCommittedMutation()
    return { status: 'success' as const }
  }, '조직을 수정하지 못했습니다.')
}

export async function updateRoleOnServer(payload: UpdateRoleRequest) {
  return withServerOperationError(async () => {
    const response = await requestServerStatus('/roles', {
      method: 'PATCH',
      body: {
        email: normalizeEmail(payload.email),
        node_id: payload.nodeId,
        role_name: payload.roleName,
      },
    })

    if (response.status === 'error') {
      return { status: 'error' as const, message: response.message ?? '권한을 변경하지 못했습니다.' }
    }

    await refreshWorkspaceAfterCommittedMutation()
    return { status: 'success' as const }
  }, '권한을 변경하지 못했습니다.')
}

export async function createWorkItemOnServer(payload: CreateWorkItemRequest) {
  return withServerOperationError(async () => {
    const ownerUser = readWorkspaceDb().users.find((user) => user.userId === payload.ownerUserId)
    const ownerEmail = ownerUser?.email || payload.ownerUserId

    const response = await requestServerStatus('/workItems', {
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

    await refreshWorkspaceAfterCommittedMutation()
    return { status: 'success' as const, workItemId: payload.workItemId }
  }, '업무를 생성하지 못했습니다.')
}

export async function updateWorkItemOnServer(payload: UpdateWorkItemRequest) {
  return withServerOperationError(async () => {
    const response = await requestServerStatus('/workItems', {
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

    await refreshWorkspaceAfterCommittedMutation()
    return { status: 'success' as const, workItemId: payload.workItemId }
  }, '업무를 수정하지 못했습니다.')
}
