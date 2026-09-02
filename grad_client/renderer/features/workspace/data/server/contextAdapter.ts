import type {
  ActivityRecord,
  AuthorityRecord,
  MentionRecord,
  NodeType,
  OrganizationNodeRecord,
  RoleAssignmentRecord,
  RoleName,
  UserRecord,
  WorkItemFileRecord,
  WorkItemRecord,
  WorkItemStatus,
  WorkspaceDatabase,
} from '../../model/types'
import type { ServerContextItem } from './apiTypes'

const SERVER_DATASET_ID = 'server-workspace'
const SERVER_SEED_VERSION = 1
const UNKNOWN_OWNER_USER_ID = 'server-owner-unknown'
const UNKNOWN_OWNER_EMAIL = 'unknown-owner@local.invalid'
const WORKSPACE_CONTEXT_ITEM_TYPES = new Set(['USER', 'NODE', 'ROLE', 'WORK_ITEM', 'AUTHORITY', 'MENTION', 'ACTIVITY', 'FILE'])

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

function toBooleanValue(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const s = value.trim().toLowerCase()
    if (s === 'true' || s === 't' || s === '1') return true
    if (s === 'false' || s === 'f' || s === '0') return false
  }
  if (typeof value === 'number') return value !== 0
  return fallback
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

    if (!WORKSPACE_CONTEXT_ITEM_TYPES.has(itemType)) {
      addIssue(index, itemType, `지원하지 않는 컨텍스트 항목 type(${itemType})입니다.`)
    }
  })

  function ensureUserByEmail(emailValue: unknown, nameValue?: unknown, userIdValue?: unknown) {
    const email = normalizeEmail(emailValue)

    if (!email) {
      return null
    }

    const knownUserId = userIdByEmail.get(email)

    if (knownUserId) {
      const existing = usersById.get(knownUserId)
      if (existing) {
        if (nameValue && !existing.name) existing.name = toOptionalString(nameValue) ?? existing.name
        return existing
      }
    }

    const userId = toOptionalString(userIdValue) ?? email
    const user: UserRecord = {
      userId,
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
      email: email || `${userId}@local.generated`,
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

  // 1. 유저 정보 사전 추출 (ROLE, WORK_ITEM, FILE, ACTIVITY, USER 등)
  items.forEach((item) => {
    const itemType = toStringValue(item.type).toUpperCase()

    if (itemType === 'USER') {
      const email = normalizeEmail(item.email ?? item.user_email)
      const userId = toOptionalString(item.id) ?? email
      if (userId) {
        const user = ensureUserById(userId, email, item.name ?? item.title)
        const personalNodeId = toNumberValue(item.personal_node_id, 0)
        if (user && personalNodeId > 0) {
          user.personalNodeId = personalNodeId
        }
      }
    } else if (itemType === 'ROLE') {
      if (item.user_id) {
        ensureUserById(item.user_id, item.email ?? item.user_email, item.user_name ?? item.name)
      } else {
        ensureUserByEmail(item.email ?? item.user_email, item.user_name ?? item.name)
      }
    } else if (itemType === 'WORK_ITEM') {
      if (item.owner_user_id) {
        ensureUserById(item.owner_user_id, item.owner_user_email)
      }
    } else if (itemType === 'FILE') {
      if (item.uploader_user_id) {
        ensureUserById(item.uploader_user_id, item.uploader_email, item.uploader_name)
      }
    } else if (itemType === 'ACTIVITY') {
      if (item.actor_user_id) {
        ensureUserById(item.actor_user_id, undefined, item.actor_name)
      }
    }
  })

  // 2. 노드(NODE) 파싱
  const nodes: OrganizationNodeRecord[] = []
  items.forEach((item, index) => {
    const itemType = toStringValue(item.type).toUpperCase()
    if (itemType !== 'NODE') return

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
      isDeleted: toBooleanValue(item.is_deleted, false),
      createdAt: toOptionalString(item.created_at ?? item.updated_at) ?? timestamp,
      updatedAt: toOptionalString(item.updated_at),
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

  // 3. 역할(ROLE) 파싱
  const roles: RoleAssignmentRecord[] = []
  items.forEach((item, index) => {
    const itemType = toStringValue(item.type).toUpperCase()
    if (itemType !== 'ROLE') return

    const nodeId = toNumberValue(item.node_id ?? item.parent_id, 0)
    const email = normalizeEmail(item.email ?? item.user_email ?? item.title)
    const user = ensureUserByEmail(email)

    if (!user || nodeId <= 0) {
      addIssue(index, itemType, '역할의 사용자 이메일 또는 노드 ID가 없어 항목을 제외했습니다.')
      return
    }

    const roleName = normalizeRoleName(item.role ?? item.role_name ?? item.status)
    roles.push({
      id: toNumberValue(item.id, index + 1),
      userId: user.userId,
      nodeId,
      roleName,
      isDeleted: toBooleanValue(item.is_deleted, false),
      createdAt: toOptionalString(item.created_at ?? item.updated_at) ?? timestamp,
      updatedAt: toOptionalString(item.updated_at),
    })

    if (roleName === 'ADMIN' && nodesById.get(nodeId)?.nodeType === 'USER') {
      user.personalNodeId = nodeId
    }
  })

  // 4. 업무(WORK_ITEM) 파싱
  let unknownOwner: UserRecord | null = null
  const workItems: WorkItemRecord[] = []
  const referenceWorkItemsById = new Map(
    (options.referenceWorkspace?.workItems ?? []).map((item) => [item.workItemId, item]),
  )

  items.forEach((item, index) => {
    const itemType = toStringValue(item.type).toUpperCase()
    if (itemType !== 'WORK_ITEM') return

    const workItemId = toOptionalString(item.id)
    const referenceWorkItem = workItemId ? referenceWorkItemsById.get(workItemId) : undefined
    const ownerNodeId = toNumberValue(
      item.owner_node_id ?? item.parent_id,
      referenceWorkItem?.ownerNodeId ?? 0,
    )

    if (!workItemId || ownerNodeId <= 0) {
      addIssue(index, itemType, '업무 ID 또는 소유 노드 ID가 없어 항목을 제외했습니다.')
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
      item.parent_work_item_id ?? item.parent_id,
    )
    const rawPriority = toNumberValue(item.priority, referenceWorkItem?.priority ?? 3)
    const rawWeight = toNumberValue(item.weight, referenceWorkItem?.weight ?? 1)
    const rawProgress = toNumberValue(item.progress, referenceWorkItem?.progress ?? 0)
    const commentCount = toNumberValue(item.comment_count, referenceWorkItem?.commentCount ?? 0)
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
      category: toOptionalString(item.category) ?? referenceWorkItem?.category,
      status:
        item.status !== undefined
          ? normalizeWorkItemStatus(item.status)
          : referenceWorkItem?.status ?? 'todo',
      priority: rawPriority >= 1 && rawPriority <= 5 ? rawPriority : 3,
      hidden: toBooleanValue(item.hidden, false),
      weight: rawWeight >= 0 ? rawWeight : 1,
      progress: Math.min(100, Math.max(0, rawProgress)),
      commentCount,
      isDeleted: toBooleanValue(item.is_deleted, false),
      ...(startDate ? { startDate } : {}),
      ...(dueDate ? { dueDate } : {}),
      ...(parentWorkItemId ? { parentWorkItemId } : {}),
      createdAt:
        toOptionalString(item.created_at) ??
        referenceWorkItem?.createdAt ??
        toOptionalString(item.updated_at) ??
        timestamp,
      updatedAt: toOptionalString(item.updated_at),
    })
  })

  // 5. 권한(AUTHORITY) 파싱
  const authorities: AuthorityRecord[] = []
  items.forEach((item) => {
    if (toStringValue(item.type).toUpperCase() !== 'AUTHORITY') return
    const id = toNumberValue(item.id, 0)
    const nodeId = toNumberValue(item.node_id, 0)
    if (id > 0 && nodeId > 0) {
      authorities.push({
        id,
        nodeId,
        roleName: normalizeRoleName(item.role),
        authority: toStringValue(item.authority),
        updatedAt: toOptionalString(item.updated_at),
      })
    }
  })

  // 6. 멘션(MENTION) 파싱
  const mentions: MentionRecord[] = []
  items.forEach((item) => {
    if (toStringValue(item.type).toUpperCase() !== 'MENTION') return
    const id = toNumberValue(item.id, 0)
    const commentId = toNumberValue(item.comment_id, 0)
    const workItemId = toStringValue(item.work_item_id)
    if (id > 0) {
      mentions.push({
        id,
        commentId,
        workItemId,
        message: toStringValue(item.message),
        isRead: toBooleanValue(item.is_read, false),
        createdAt: toOptionalString(item.created_at) ?? timestamp,
        updatedAt: toOptionalString(item.updated_at),
      })
    }
  })

  // 7. 활동(ACTIVITY) 파싱
  const activities: ActivityRecord[] = []
  items.forEach((item) => {
    if (toStringValue(item.type).toUpperCase() !== 'ACTIVITY') return
    const id = toNumberValue(item.id, 0)
    const nodeId = toNumberValue(item.node_id, 0)
    if (id > 0) {
      activities.push({
        id,
        nodeId,
        actorUserId: toStringValue(item.actor_user_id),
        actorName: toStringValue(item.actor_name),
        entityType: toStringValue(item.entity_type),
        entityId: toStringValue(item.entity_id),
        targetName: toStringValue(item.target_name),
        actionType: toStringValue(item.action_type),
        fieldName: item.field_name ? toStringValue(item.field_name) : null,
        oldValue: item.old_value ? toStringValue(item.old_value) : null,
        newValue: item.new_value ? toStringValue(item.new_value) : null,
        createdAt: toOptionalString(item.created_at) ?? timestamp,
      })
    }
  })

  // 8. 파일(FILE) 파싱
  const files: WorkItemFileRecord[] = []
  items.forEach((item) => {
    if (toStringValue(item.type).toUpperCase() !== 'FILE') return
    const id = toNumberValue(item.id, 0)
    const workItemId = toStringValue(item.work_item_id)
    if (id > 0 && workItemId) {
      files.push({
        id,
        workItemId,
        uploaderUserId: toStringValue(item.uploader_user_id),
        uploaderName: toStringValue(item.uploader_name),
        uploaderEmail: toStringValue(item.uploader_email),
        originalFileName: toStringValue(item.original_file_name),
        fileSize: toNumberValue(item.file_size, 0),
        mimeType: item.mime_type ? toStringValue(item.mime_type) : null,
        isDeleted: toBooleanValue(item.is_deleted, false),
        createdAt: toOptionalString(item.created_at) ?? timestamp,
        updatedAt: toOptionalString(item.updated_at),
      })
    }
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
      authorities,
      mentions,
      activities,
      files,
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
