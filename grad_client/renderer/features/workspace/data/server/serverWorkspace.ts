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
  WorkItemCommentRecord,
  WorkItemFileRecord,
  WorkspaceDatabase,
} from '../../model/types'
import {
  apiRequest,
  clearServerSession,
  getServerAccessToken,
  getServerSessionEmail,
  hasServerSession,
  refreshServerTokens,
  setServerSession,
  type ApiRequestOptions,
} from './apiClient.js'
import {
  getServerLoginTokens,
  isServerStatusResponse,
  parseServerContextItems,
  type ServerContextResponse,
  type ServerLoginResponse,
} from './apiTypes.js'
import { normalizeServerContext } from './contextAdapter.js'
import { getWorkspaceApiBaseUrl } from './workspaceMode.js'
import { clearServerWorkspaceDb, readWorkspaceDb, writeServerWorkspaceDb } from '../localStore.js'
import { setCurrentSessionUserId } from '../session.js'
import { notifyWorkspaceCacheRefreshFailed } from '../workspaceCacheEvents.js'

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

export async function fetchServerUserProfile(email = getCurrentServerEmail()): Promise<UserRecord | null> {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return null

  try {
    const response = await apiRequest<unknown>(`/users?target_email=${encodeURIComponent(normalizedEmail)}`)
    if (!isServerStatusResponse(response) || response.status === 'error') {
      return null
    }

    const data = (response as { data?: unknown }).data
    const items = Array.isArray(data) ? data : []
    const profile = items.find(
      (item) => typeof item === 'object' && item !== null && (item as Record<string, unknown>).type === 'USER',
    ) as Record<string, unknown> | undefined

    if (!profile) return null

    const userId = typeof profile.id === 'string' && profile.id.trim() ? profile.id.trim() : normalizedEmail
    const name = typeof profile.name === 'string' && profile.name.trim() ? profile.name.trim() : normalizedEmail
    const personalNodeId = typeof profile.personal_node_id === 'number' ? profile.personal_node_id : undefined

    return {
      userId,
      email: normalizedEmail,
      name,
      createdAt: typeof profile.created_at === 'string' ? profile.created_at : new Date().toISOString(),
      ...(personalNodeId !== undefined ? { personalNodeId } : {}),
    }
  } catch (error) {
    console.warn('[WorkspaceAdapter] 사용자 프로필 조회 실패:', error)
    return null
  }
}

export async function loadServerWorkspace(email = getCurrentServerEmail()) {
  const profilePromise = fetchServerUserProfile(email)
  const response = await apiRequest<unknown>('/context/init')

  if (!isServerStatusResponse(response)) {
    throw new Error('서버 컨텍스트 응답 형식이 올바르지 않습니다.')
  }

  if (response.status === 'error') {
    throw new Error(response.message ?? '워크스페이스를 불러오지 못했습니다.')
  }

  const items = parseServerContextItems((response as ServerContextResponse).data)
  const { workspace: db, issues } = normalizeServerContext(items, email)

  // 사용자 프로필 정보가 조회되었으면 db.users 및 세션 동기화
  const profile = await profilePromise
  if (profile) {
    const existingIndex = db.users.findIndex((u) => u.email === profile.email || u.userId === profile.userId)
    if (existingIndex >= 0) {
      db.users[existingIndex] = { ...db.users[existingIndex], ...profile }
    } else {
      db.users.push(profile)
    }
    setCurrentSessionUserId(profile.userId)
  }

  if (issues.length > 0) {
    console.warn('[WorkspaceAdapter] 일부 컨텍스트 항목 정규화 이슈:', issues)
  }

  writeServerWorkspaceDb(db)

  // 워크스페이스 로드/새로고침 시 웹소켓이 아직 연결되지 않았거나 닫혀있으면 연결 수립
  if (hasServerSession()) {
    connectNotificationWebSocket().catch((err) => {
      console.warn('[WorkspaceAdapter] 초기 웹소켓 연결 백그라운드 시도:', err)
    })
  }

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

export async function fetchNodeDetailOnServer(nodeId: number | string) {
  const parsedId = typeof nodeId === 'number' ? nodeId : parseInt(nodeId, 10)
  if (!Number.isFinite(parsedId) || parsedId <= 0) {
    return readWorkspaceDb()
  }

  const response = await apiRequest<unknown>(`/org/nodes?node_id=${parsedId}`)

  if (!isServerStatusResponse(response)) {
    throw new Error('노드 상세 조회 응답 형식이 올바르지 않습니다.')
  }

  if (response.status === 'error') {
    throw new Error(response.message ?? '노드 상세 정보를 불러오지 못했습니다.')
  }

  const items = parseServerContextItems((response as ServerContextResponse).data)
  const current = readWorkspaceDb()
  const { workspace: normalized, issues } = normalizeServerContext(
    items,
    getCurrentServerEmail(),
    { referenceWorkspace: current },
  )

  if (issues.length > 0) {
    console.warn('[WorkspaceAdapter] 노드 상세 항목 정규화 이슈:', issues)
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

    // 동기화 이전에 실시간 알림 웹소켓 채널 연결 (최대 1.5초 타임아웃으로 로그인 블로킹 방지)
    if (tokens.accessToken) {
      Promise.race([
        connectNotificationWebSocket(tokens.accessToken),
        new Promise((_, reject) => setTimeout(() => reject(new Error('WebSocket connection timeout')), 1500)),
      ]).catch((wsError) => {
        console.warn('[WorkspaceAdapter] WebSocket 백그라운드 연결 진행:', wsError)
      })
    }

    const db = await loadServerWorkspace(email)

    const user = getCurrentServerUser(db) ?? createServerSessionUser(email)

    return {
      status: 'success',
      user,
    }
  } catch (error) {
    if (shouldRollbackSession) {
      disconnectNotificationWebSocket()
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
  disconnectNotificationWebSocket()
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

    const items = parseServerContextItems((response as ServerContextResponse).data)
    const createdNodeItem = items.find((item) => (item.type ?? '').toUpperCase() === 'NODE')
    const newNodeId = createdNodeItem?.id !== undefined ? Number(createdNodeItem.id) : 0

    await refreshWorkspaceAfterCommittedMutation()
    return { status: 'success' as const, newNodeId }
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

    const items = parseServerContextItems((response as ServerContextResponse).data)
    const createdNodeItem = items.find((item) => (item.type ?? '').toUpperCase() === 'NODE')
    const newNodeId = createdNodeItem?.id !== undefined ? Number(createdNodeItem.id) : 0

    await refreshWorkspaceAfterCommittedMutation()
    return { status: 'success' as const, newNodeId }
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

export type UpdateRoleAuthorityRequest = {
  nodeId: number
  roleName: string
  authority: string
}

export async function updateRoleAuthorityOnServer(payload: UpdateRoleAuthorityRequest) {
  return withServerOperationError(async () => {
    const response = await requestServerStatus('/roles/definition', {
      method: 'PATCH',
      body: {
        node_id: payload.nodeId,
        role_name: payload.roleName,
        authority: payload.authority,
      },
    })

    if (response.status === 'error') {
      return { status: 'error' as const, message: response.message ?? '역할 권한을 변경하지 못했습니다.' }
    }

    await refreshWorkspaceAfterCommittedMutation()
    return { status: 'success' as const }
  }, '역할 권한을 변경하지 못했습니다.')
}

export type CreateRoleDefinitionRequest = {
  nodeId: number
  roleName: string
  authority: string
}

export async function createRoleDefinitionOnServer(payload: CreateRoleDefinitionRequest) {
  return withServerOperationError(async () => {
    const response = await requestServerStatus('/roles/definition', {
      method: 'POST',
      body: {
        node_id: payload.nodeId,
        role_name: payload.roleName,
        authority: payload.authority,
      },
    })

    if (response.status === 'error') {
      return { status: 'error' as const, message: response.message ?? '새 역할을 생성하지 못했습니다.' }
    }

    await refreshWorkspaceAfterCommittedMutation()
    return { status: 'success' as const }
  }, '새 역할을 생성하지 못했습니다.')
}

export type RenameRoleDefinitionRequest = {
  nodeId: number
  oldRoleName: string
  newRoleName: string
}

export async function renameRoleDefinitionOnServer(payload: RenameRoleDefinitionRequest) {
  return withServerOperationError(async () => {
    const response = await requestServerStatus('/roles/rename', {
      method: 'PATCH',
      body: {
        node_id: payload.nodeId,
        old_role_name: payload.oldRoleName,
        new_role_name: payload.newRoleName,
      },
    })

    if (response.status === 'error') {
      return { status: 'error' as const, message: response.message ?? '역할 이름을 변경하지 못했습니다.' }
    }

    await refreshWorkspaceAfterCommittedMutation()
    return { status: 'success' as const }
  }, '역할 이름을 변경하지 못했습니다.')
}

export type WorkItemDetailResult = {
  item: WorkspaceDatabase['workItems'][number]
  comments: WorkItemCommentRecord[]
  files: WorkItemFileRecord[]
}

export async function fetchWorkItemDetailOnServer(workItemId: string): Promise<WorkItemDetailResult> {
  const normalizedId = workItemId.trim()
  if (!normalizedId) {
    throw new Error('유효한 업무 ID가 아닙니다.')
  }

  const response = await apiRequest<unknown>(`/workItems?work_item_id=${encodeURIComponent(normalizedId)}`)

  if (!isServerStatusResponse(response)) {
    throw new Error('업무 상세 조회 응답 형식이 올바르지 않습니다.')
  }

  if (response.status === 'error') {
    throw new Error(response.message ?? '업무 상세 정보를 불러오지 못했습니다.')
  }

  const rawItems = parseServerContextItems((response as ServerContextResponse).data)
  const detailItem = rawItems.find(
    (item) => String(item.type).toUpperCase() === 'WORK_ITEM_DETAIL' || String(item.type).toUpperCase() === 'WORK_ITEM',
  )

  if (!detailItem) {
    throw new Error('업무 상세 데이터를 찾을 수 없습니다.')
  }

  const current = readWorkspaceDb()

  // comments 추출
  const comments: WorkItemCommentRecord[] = []
  if (Array.isArray((detailItem as Record<string, unknown>).comments)) {
    const rawComments = (detailItem as Record<string, unknown>).comments as Array<Record<string, unknown>>
    rawComments.forEach((c) => {
      comments.push({
        commentId: Number(c.comment_id ?? 0),
        authorUserId: String(c.author_user_id ?? ''),
        authorName: String(c.author_name ?? c.author_email ?? '작성자'),
        authorEmail: String(c.author_email ?? ''),
        content: String(c.content ?? ''),
        createdAt: String(c.created_at ?? new Date().toISOString()),
      })
    })
  }

  // files 추출
  const files: WorkItemFileRecord[] = []
  if (Array.isArray((detailItem as Record<string, unknown>).files)) {
    const rawFiles = (detailItem as Record<string, unknown>).files as Array<Record<string, unknown>>
    rawFiles.forEach((f) => {
      files.push({
        id: Number(f.file_id ?? 0),
        workItemId: normalizedId,
        uploaderUserId: String(f.uploader_user_id ?? ''),
        uploaderName: String(f.uploader_name ?? f.uploader_email ?? '업로더'),
        uploaderEmail: String(f.uploader_email ?? ''),
        originalFileName: String(f.original_file_name ?? `file_${f.file_id}`),
        fileSize: Number(f.file_size ?? 0),
        mimeType: f.mime_type ? String(f.mime_type) : null,
        isDeleted: Boolean(f.is_deleted),
        createdAt: String(f.created_at ?? new Date().toISOString()),
      })
    })
  }

  // WORK_ITEM으로 contextAdapter에 전달하여 workItems, users 정규화
  const contextItems: typeof rawItems = [
    {
      ...detailItem,
      type: 'WORK_ITEM',
      id: detailItem.work_item_id ?? detailItem.id ?? normalizedId,
    },
    ...files.map((f) => ({
      type: 'FILE',
      id: f.id,
      work_item_id: f.workItemId,
      uploader_user_id: f.uploaderUserId,
      uploader_name: f.uploaderName,
      uploader_email: f.uploaderEmail,
      original_file_name: f.originalFileName,
      file_size: f.fileSize,
      mime_type: f.mimeType,
      created_at: f.createdAt,
    })),
  ]

  const { workspace: normalized } = normalizeServerContext(
    contextItems,
    getCurrentServerEmail(),
    { referenceWorkspace: current },
  )

  const merged = mergeServerUpdates(current, normalized)
  writeServerWorkspaceDb(merged)

  const foundItem = merged.workItems.find((w) => w.workItemId === normalizedId)
  if (!foundItem) {
    throw new Error('정규화된 업무 데이터를 찾을 수 없습니다.')
  }

  return {
    item: foundItem,
    comments,
    files,
  }
}

export async function addWorkItemCommentOnServer(workItemId: string, content: string) {
  return withServerOperationError(async () => {
    const response = await requestServerStatus('/workItems/comments', {
      method: 'POST',
      body: {
        work_item_id: workItemId,
        content,
      },
    })

    if (response.status === 'error') {
      return { status: 'error' as const, message: response.message ?? '댓글을 등록하지 못했습니다.' }
    }

    return { status: 'success' as const }
  }, '댓글을 등록하지 못했습니다.')
}

// ----------------------------------------------------
// 실시간 알림 WebSocket 클라이언트 매니저 (지수 백오프 자동 재연결 포함)
// ----------------------------------------------------
let notificationSocket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let reconnectAttempts = 0
let isIntentionalDisconnect = false
const MAX_RECONNECT_DELAY_MS = 30_000
const INITIAL_RECONNECT_DELAY_MS = 1_000

export function getNotificationWebSocketUrl(token: string): string {
  const apiBaseUrl = getWorkspaceApiBaseUrl()
  const wsProtocol = apiBaseUrl.startsWith('https') ? 'wss:' : 'ws:'
  const urlObj = new URL(apiBaseUrl)
  urlObj.protocol = wsProtocol
  urlObj.pathname = `${urlObj.pathname.replace(/\/+$/, '')}/notification/ws`
  urlObj.searchParams.set('token', token)
  return urlObj.toString()
}

function scheduleWebSocketReconnect() {
  if (isIntentionalDisconnect || !hasServerSession()) {
    return
  }

  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  // 지수 백오프: 1s, 2s, 4s, 8s, 16s... (최대 30s) + 20% 지터
  const baseDelay = Math.min(INITIAL_RECONNECT_DELAY_MS * Math.pow(1.5, reconnectAttempts), MAX_RECONNECT_DELAY_MS)
  const jitter = baseDelay * (0.8 + Math.random() * 0.4)
  const delay = Math.round(jitter)

  console.info(`[WebSocket] ${delay}ms 후 실시간 알림 서버 재연결을 시도합니다. (시도 ${reconnectAttempts + 1}회)`)

  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null
    if (isIntentionalDisconnect || !hasServerSession()) {
      return
    }

    // 1. 토큰 만료 가능성을 대비하여 필요시 리프레시
    let token = getServerAccessToken()
    if (reconnectAttempts > 0 || !token) {
      const refreshed = await refreshServerTokens()
      if (refreshed) {
        token = refreshed
      }
    }

    if (!token || isIntentionalDisconnect) {
      return
    }

    try {
      reconnectAttempts += 1
      await connectNotificationWebSocket(token)
    } catch (err) {
      console.warn('[WebSocket] 자동 재연결 실패 -> 다음 재연결 예약:', err)
      scheduleWebSocketReconnect()
    }
  }, delay)
}

let pingIntervalTimer: ReturnType<typeof setInterval> | null = null

function stopHeartbeat() {
  if (pingIntervalTimer) {
    clearInterval(pingIntervalTimer)
    pingIntervalTimer = null
  }
}

function startHeartbeat(socket: WebSocket) {
  stopHeartbeat()
  // 15초마다 가벼운 핑 전송 (연결 활성 유지)
  pingIntervalTimer = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({ type: 'PING' }))
      } catch {
        // ignore
      }
    } else {
      stopHeartbeat()
    }
  }, 15000)
}

let connectPromise: Promise<WebSocket> | null = null

export function connectNotificationWebSocket(token?: string | null): Promise<WebSocket> {
  if (notificationSocket && (notificationSocket.readyState === WebSocket.OPEN || notificationSocket.readyState === WebSocket.CONNECTING)) {
    if (connectPromise) {
      return connectPromise
    }
    return Promise.resolve(notificationSocket)
  }

  const accessToken = token ?? getServerAccessToken()
  if (!accessToken) {
    return Promise.reject(new Error('WebSocket 연결을 위한 인증 토큰이 없습니다.'))
  }

  isIntentionalDisconnect = false

  if (notificationSocket) {
    try {
      notificationSocket.close()
    } catch {
      // ignore
    }
    notificationSocket = null
  }

  stopHeartbeat()

  const promise = new Promise<WebSocket>((resolve, reject) => {
    let isHandshakeComplete = false

    try {
      const wsUrl = getNotificationWebSocketUrl(accessToken)
      const socket = new WebSocket(wsUrl)
      notificationSocket = socket

      const timeoutId = setTimeout(() => {
        if (!isHandshakeComplete && socket.readyState !== WebSocket.OPEN) {
          try {
            socket.close()
          } catch {
            // ignore
          }
          if (notificationSocket === socket) {
            notificationSocket = null
          }
          reject(new Error('실시간 알림 서버(WebSocket) 연결 시간이 초과되었습니다.'))
          if (!isIntentionalDisconnect && hasServerSession()) {
            scheduleWebSocketReconnect()
          }
        }
      }, 5000)

      socket.onopen = () => {
        isHandshakeComplete = true
        clearTimeout(timeoutId)
        reconnectAttempts = 0
        if (reconnectTimer) {
          clearTimeout(reconnectTimer)
          reconnectTimer = null
        }
        console.info('[WebSocket] 실시간 알림 서버 연결 성공')
        startHeartbeat(socket)
        resolve(socket)
      }

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data)
          console.debug('[WebSocket] 수신 알림:', payload)
        } catch {
          console.debug('[WebSocket] 수신 메시지:', event.data)
        }
      }

      socket.onerror = (error) => {
        if (!isHandshakeComplete) {
          clearTimeout(timeoutId)
          console.warn('[WebSocket] 실시간 알림 서버 연결 핸드셰이크 오류:', error)
          reject(new Error('실시간 알림 서버 연결 중 오류가 발생했습니다.'))
        } else {
          console.warn('[WebSocket] 실시간 알림 서버 통신 오류:', error)
        }
      }

      socket.onclose = (event) => {
        clearTimeout(timeoutId)
        stopHeartbeat()
        console.info(`[WebSocket] 실시간 알림 서버 연결 종료 (코드: ${event.code})`)
        if (notificationSocket === socket) {
          notificationSocket = null
        }

        if (!isHandshakeComplete) {
          reject(new Error(`WebSocket 연결이 조기 종료되었습니다. (코드: ${event.code})`))
        }

        // 의도적인 로그아웃이 아니면 자동 재연결 예약
        if (!isIntentionalDisconnect && hasServerSession()) {
          scheduleWebSocketReconnect()
        }
      }
    } catch (err) {
      stopHeartbeat()
      if (notificationSocket) {
        notificationSocket = null
      }
      reject(err)
      if (!isIntentionalDisconnect && hasServerSession()) {
        scheduleWebSocketReconnect()
      }
    }
  }).finally(() => {
    connectPromise = null
  })

  connectPromise = promise
  return promise
}

export function disconnectNotificationWebSocket() {
  isIntentionalDisconnect = true
  stopHeartbeat()
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  reconnectAttempts = 0
  if (notificationSocket) {
    notificationSocket.close()
    notificationSocket = null
  }
}

