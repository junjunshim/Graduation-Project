import type {
  NodeType,
  OrganizationNodeRecord,
  RoleAssignmentRecord,
  RoleName,
  UserRecord,
  WorkItemRecord,
  WorkItemStatus,
  WorkspaceDatabase,
} from '../../model/types'
import type { ServerContextItem } from './apiTypes'

const SERVER_DATASET_ID = 'server-workspace'
const SERVER_SEED_VERSION = 1
const UNKNOWN_OWNER_USER_ID = 'server-owner-unknown'
const UNKNOWN_OWNER_EMAIL = 'unknown-owner@local.invalid'
const WORKSPACE_CONTEXT_ITEM_TYPES = new Set(['USER', 'NODE', 'ROLE', 'WORK_ITEM'])
// The server includes these records in the shared context envelope, but the
// current workspace domain has no authority-policy or notification collection.
// Accept them without misrepresenting them as roles or work items.
const KNOWN_NON_WORKSPACE_CONTEXT_ITEM_TYPES = new Set(['AUTHORITY', 'MENTION'])

export type ServerContextNormalizationIssue = {
  index: number
  itemType: string
  message: string
}

export type ServerContextNormalizationResult = {
  workspace: WorkspaceDatabase
  issues: ServerContextNormalizationIssue[]
  lastUpdatedAt?: string
}

export type ServerContextNormalizationOptions = {
  referenceWorkspace?: Pick<WorkspaceDatabase, 'users' | 'nodes' | 'workItems'>
}

function nowIso() {
  return new Date().toISOString()
}

function toStringValue(value: unknown) {
  return value === undefined || value === null ? '' : String(value)
}

function toOptionalString(value: unknown) {
  const normalized = toStringValue(value).trim()
  return normalized || undefined
}

function toNumberValue(value: unknown, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeEmail(value: unknown) {
  return toStringValue(value).trim().toLowerCase()
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

  if (
    normalized === 'ADMIN' ||
    normalized === 'MANAGER' ||
    normalized === 'MEMBER' ||
    normalized === 'VIEWER'
  ) {
    return normalized
  }

  return 'MEMBER'
}

function normalizeWorkItemStatus(value: unknown): WorkItemStatus {
  const normalized = toStringValue(value).trim().toLowerCase().replace(/_/g, '-')

  if (normalized === 'in-progress' || normalized === 'doing') {
    return 'in-progress'
  }

  if (normalized === 'done' || normalized === 'end' || normalized === 'completed') {
    return 'done'
  }

  return 'todo'
}

function parseNodePath(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(Number).filter(Number.isFinite)
  }

  const matches = toStringValue(value).match(/\d+/g)
  return matches ? matches.map(Number).filter(Number.isFinite) : []
}

function computeNodePath(
  nodeId: number,
  nodesById: Map<number, OrganizationNodeRecord>,
  trail = new Set<number>(),
): number[] {
  if (trail.has(nodeId)) {
    return [nodeId]
  }

  const node = nodesById.get(nodeId)

  if (!node?.parentNodeId || !nodesById.has(node.parentNodeId)) {
    return [nodeId]
  }

  trail.add(nodeId)
  return [...computeNodePath(node.parentNodeId, nodesById, trail), nodeId]
}

function getLatestTimestamp(values: Array<string | undefined>) {
  let latest: { value: string; time: number } | undefined

  values.forEach((value) => {
    if (!value) {
      return
    }

    const time = new Date(value).getTime()

    if (!Number.isNaN(time) && (!latest || time > latest.time)) {
      latest = { value, time }
    }
  })

  return latest?.value
}

export function normalizeServerContext(
  items: ServerContextItem[],
  currentEmail: string,
  options: ServerContextNormalizationOptions = {},
): ServerContextNormalizationResult {
  const timestamp = nowIso()
  const issues: ServerContextNormalizationIssue[] = []
  const usersById = new Map<string, UserRecord>(
    (options.referenceWorkspace?.users ?? []).map((user) => [user.userId, { ...user }]),
  )
  const userIdByEmail = new Map<string, string>(
    Array.from(usersById.values())
      .filter((user) => Boolean(user.email))
      .map((user) => [normalizeEmail(user.email), user.userId]),
  )

  function addIssue(index: number, itemType: string, message: string) {
    issues.push({ index, itemType, message })
  }

  items.forEach((item, index) => {
    const itemType = toStringValue(item.type).trim().toUpperCase()

    if (!itemType) {
      addIssue(index, 'UNKNOWN', '컨텍스트 항목의 type이 없어 응답을 신뢰할 수 없습니다.')
      return
    }

    if (
      !WORKSPACE_CONTEXT_ITEM_TYPES.has(itemType) &&
      !KNOWN_NON_WORKSPACE_CONTEXT_ITEM_TYPES.has(itemType)
    ) {
      addIssue(index, itemType, `지원하지 않는 컨텍스트 항목 type(${itemType})입니다.`)
    }
  })

  function ensureUserByEmail(emailValue: unknown, nameValue?: unknown) {
    const email = normalizeEmail(emailValue)

    if (!email) {
      return null
    }

    const knownUserId = userIdByEmail.get(email)

    if (knownUserId) {
      return usersById.get(knownUserId) ?? null
    }

    const user: UserRecord = {
      userId: email,
      email,
      name: toOptionalString(nameValue) ?? getDisplayNameFromEmail(email),
      createdAt: timestamp,
    }

    usersById.set(user.userId, user)
    userIdByEmail.set(email, user.userId)
    return user
  }

  function ensureUserById(userIdValue: unknown, emailValue?: unknown, nameValue?: unknown) {
    const userId = toOptionalString(userIdValue)

    if (!userId) {
      return null
    }

    const email = normalizeEmail(emailValue)
    const name = toOptionalString(nameValue)
    const existing = usersById.get(userId)

    if (existing) {
      if (email) {
        existing.email = email
        userIdByEmail.set(email, userId)
      }

      if (name) {
        existing.name = name
      }

      return existing
    }

    const knownUserId = email ? userIdByEmail.get(email) : undefined
    const knownUser = knownUserId ? usersById.get(knownUserId) : undefined

    if (knownUserId && knownUser && knownUserId !== userId) {
      usersById.delete(knownUserId)
      knownUser.userId = userId
      knownUser.email = email
      knownUser.name = name ?? knownUser.name
      usersById.set(userId, knownUser)
      userIdByEmail.set(email, userId)
      return knownUser
    }

    const user: UserRecord = {
      userId,
      email,
      name: name ?? (email ? getDisplayNameFromEmail(email) : userId),
      createdAt: timestamp,
    }

    usersById.set(userId, user)

    if (email) {
      userIdByEmail.set(email, userId)
    }

    return user
  }

  const normalizedCurrentEmail = normalizeEmail(currentEmail)
  const currentUser = normalizedCurrentEmail
    ? ensureUserByEmail(normalizedCurrentEmail)
    : null

  items.forEach((item, index) => {
    if (toStringValue(item.type).toUpperCase() !== 'USER') {
      return
    }

    const email = normalizeEmail(item.email ?? item.user_email)
    const userId = toOptionalString(item.id) ?? email

    if (!userId) {
      addIssue(index, 'USER', '사용자 ID 또는 이메일이 없어 항목을 제외했습니다.')
      return
    }

    const user = ensureUserById(userId, email, item.name ?? item.title)
    const personalNodeId = toNumberValue(item.personal_node_id, 0)

    if (user && personalNodeId > 0) {
      user.personalNodeId = personalNodeId
    }
  })

  items.forEach((item) => {
    if (
      toStringValue(item.type).toUpperCase() === 'WORK_ITEM' &&
      toOptionalString(item.owner_user_id)
    ) {
      ensureUserById(item.owner_user_id, item.owner_user_email)
    }
  })

  const nodes: OrganizationNodeRecord[] = []

  items.forEach((item, index) => {
    const itemType = toStringValue(item.type).toUpperCase()

    if (itemType !== 'NODE') {
      return
    }

    const id = toNumberValue(item.id ?? item.node_id, 0)

    if (id <= 0) {
      addIssue(index, itemType, '유효한 노드 ID가 없어 항목을 제외했습니다.')
      return
    }

    const parentNodeId = toNumberValue(item.parent_id, 0)
    const path = parseNodePath(item.path ?? item.extra_info)

    nodes.push({
      id,
      ...(parentNodeId > 0 ? { parentNodeId } : {}),
      nodeType: normalizeNodeType(item.node_type),
      name: toOptionalString(item.name ?? item.title) ?? `Node ${id}`,
      path,
      createdAt: toOptionalString(item.created_at ?? item.updated_at) ?? timestamp,
    })
  })

  const nodesById = new Map<number, OrganizationNodeRecord>(
    (options.referenceWorkspace?.nodes ?? []).map((node) => [node.id, node]),
  )
  nodes.forEach((node) => nodesById.set(node.id, node))
  nodes.forEach((node) => {
    const validPath = node.path.length > 0 && node.path[node.path.length - 1] === node.id
    node.path = validPath ? node.path : computeNodePath(node.id, nodesById)
  })

  const roles: RoleAssignmentRecord[] = []

  items.forEach((item, index) => {
    const itemType = toStringValue(item.type).toUpperCase()

    if (itemType !== 'ROLE') {
      return
    }

    const nodeId = toNumberValue(item.node_id ?? item.parent_id, 0)
    const email = normalizeEmail(item.email ?? item.user_email ?? item.title)
    const user = ensureUserByEmail(email)

    if (!user || nodeId <= 0) {
      addIssue(index, itemType, '역할의 사용자 이메일 또는 노드 ID가 없어 항목을 제외했습니다.')
      return
    }

    if (!nodesById.has(nodeId)) {
      addIssue(index, itemType, '역할이 참조하는 노드를 찾을 수 없어 항목을 제외했습니다.')
      return
    }

    const roleName = normalizeRoleName(item.role ?? item.role_name ?? item.status)
    roles.push({
      id: toNumberValue(item.id, index + 1),
      userId: user.userId,
      nodeId,
      roleName,
      createdAt: toOptionalString(item.created_at ?? item.updated_at) ?? timestamp,
    })

    if (roleName === 'ADMIN' && nodesById.get(nodeId)?.nodeType === 'USER') {
      user.personalNodeId = nodeId
    }
  })

  let unknownOwner: UserRecord | null = null
  const workItems: WorkItemRecord[] = []
  const referenceWorkItemsById = new Map(
    (options.referenceWorkspace?.workItems ?? []).map((item) => [item.workItemId, item]),
  )

  items.forEach((item, index) => {
    const itemType = toStringValue(item.type).toUpperCase()

    if (itemType !== 'WORK_ITEM') {
      return
    }

    const workItemId = toOptionalString(item.id)
    const referenceWorkItem = workItemId ? referenceWorkItemsById.get(workItemId) : undefined
    const usesExpandedShape = item.owner_node_id !== undefined && item.owner_node_id !== null
    const ownerNodeId = toNumberValue(
      item.owner_node_id ?? item.parent_id,
      referenceWorkItem?.ownerNodeId ?? 0,
    )

    if (!workItemId || ownerNodeId <= 0) {
      addIssue(index, itemType, '업무 ID 또는 소유 노드 ID가 없어 항목을 제외했습니다.')
      return
    }

    if (!nodesById.has(ownerNodeId)) {
      addIssue(index, itemType, '업무가 참조하는 소유 노드를 찾을 수 없어 항목을 제외했습니다.')
      return
    }

    const ownerByEmail = ensureUserByEmail(item.owner_user_email)
    const ownerById = ensureUserById(item.owner_user_id, item.owner_user_email)
    const referenceOwner = referenceWorkItem
      ? usersById.get(referenceWorkItem.ownerUserId) ?? null
      : null

    if (!ownerByEmail && !ownerById && !referenceOwner && !unknownOwner) {
      unknownOwner = {
        userId: UNKNOWN_OWNER_USER_ID,
        email: UNKNOWN_OWNER_EMAIL,
        name: '담당자 미확인',
        createdAt: timestamp,
      }
      usersById.set(unknownOwner.userId, unknownOwner)
    }

    const owner = ownerById ?? ownerByEmail ?? referenceOwner ?? unknownOwner
    const parentWorkItemId = toOptionalString(
      item.parent_work_item_id ?? (usesExpandedShape ? item.parent_id : item.extra_info),
    )
    const rawPriority = toNumberValue(item.priority, referenceWorkItem?.priority ?? 3)
    const rawWeight = toNumberValue(item.weight, referenceWorkItem?.weight ?? 1)
    const rawProgress = toNumberValue(item.progress, referenceWorkItem?.progress ?? 0)
    const startDate =
      item.start_date !== undefined
        ? toOptionalString(item.start_date)
        : referenceWorkItem?.startDate
    const dueDate =
      item.due_date !== undefined
        ? toOptionalString(item.due_date)
        : referenceWorkItem?.dueDate

    workItems.push({
      workItemId,
      ownerNodeId,
      ownerUserId: owner?.userId ?? currentUser?.userId ?? UNKNOWN_OWNER_USER_ID,
      title: toOptionalString(item.title) ?? referenceWorkItem?.title ?? workItemId,
      description:
        item.description !== undefined
          ? toOptionalString(item.description) ?? ''
          : referenceWorkItem?.description ?? '',
      status:
        item.status !== undefined
          ? normalizeWorkItemStatus(item.status)
          : referenceWorkItem?.status ?? 'todo',
      priority: rawPriority >= 1 && rawPriority <= 5 ? rawPriority : 3,
      weight: rawWeight >= 0 ? rawWeight : 1,
      progress: Math.min(100, Math.max(0, rawProgress)),
      ...(startDate ? { startDate } : {}),
      ...(dueDate ? { dueDate } : {}),
      ...(parentWorkItemId ? { parentWorkItemId } : {}),
      createdAt:
        toOptionalString(item.created_at) ??
        referenceWorkItem?.createdAt ??
        toOptionalString(item.updated_at) ??
        timestamp,
    })
  })

  const validNodeIds = new Set(nodesById.keys())
  const validUserIds = new Set(usersById.keys())
  const validWorkItemIds = new Set([
    ...referenceWorkItemsById.keys(),
    ...workItems.map((item) => item.workItemId),
  ])
  const normalizedRoles = roles.filter(
    (role) => validNodeIds.has(role.nodeId) && validUserIds.has(role.userId),
  )
  const normalizedWorkItems = workItems
    .filter((item) => validNodeIds.has(item.ownerNodeId) && validUserIds.has(item.ownerUserId))
    .map((item) => {
      if (item.parentWorkItemId && !validWorkItemIds.has(item.parentWorkItemId)) {
        const withoutInvalidParent = { ...item }
        delete withoutInvalidParent.parentWorkItemId
        return withoutInvalidParent
      }

      return item
    })

  return {
    workspace: {
      datasetId: SERVER_DATASET_ID,
      seedVersion: SERVER_SEED_VERSION,
      users: Array.from(usersById.values()),
      nodes,
      roles: normalizedRoles,
      workItems: normalizedWorkItems,
      counters: {
        node: Math.max(0, ...nodes.map((node) => node.id)) + 1,
        role: Math.max(0, ...normalizedRoles.map((role) => role.id)) + 1,
      },
    },
    issues,
    ...(getLatestTimestamp(items.map((item) => item.updated_at))
      ? { lastUpdatedAt: getLatestTimestamp(items.map((item) => item.updated_at)) }
      : {}),
  }
}
