import type {
  ClaimWorkItemRequest,
  CreateWorkItemRequest,
  UpdateWorkItemRequest,
  WorkspaceDatabase,
} from '../model/types'
import { delay, generateWorkItemId, nowIso, readWorkspaceDb, writeWorkspaceDb } from './localStore'
import { createWorkItemOnServer, updateWorkItemOnServer } from './serverWorkspace'
import { isServerDataSource } from './workspaceMode'

export function getNextGeneratedWorkItemId(workspace?: Pick<WorkspaceDatabase, 'workItems'>) {
  return generateWorkItemId(workspace ?? readWorkspaceDb())
}

export async function createWorkItem(payload: CreateWorkItemRequest) {
  if (isServerDataSource()) {
    return createWorkItemOnServer(payload)
  }

  await delay()

  const db = readWorkspaceDb()
  const ownerNode = db.nodes.find((node) => node.id === payload.ownerNodeId)
  const ownerUser = db.users.find((user) => user.userId === payload.ownerUserId.trim())
  const workItemId = payload.workItemId.trim() || generateWorkItemId(db)
  const title = payload.title.trim()
  const priority = payload.priority ?? 3
  const weight = payload.weight ?? 1
  const progress = payload.progress ?? 0

  if (!ownerNode) {
    return {
      status: 'error' as const,
      message: '소유 노드를 선택해야 합니다.',
    }
  }

  if (!ownerUser) {
    return {
      status: 'error' as const,
      message: '담당 userId를 확인할 수 없습니다.',
    }
  }

  if (!title) {
    return {
      status: 'error' as const,
      message: '업무 제목은 필수입니다.',
    }
  }

  if (db.workItems.some((item) => item.workItemId === workItemId)) {
    return {
      status: 'error' as const,
      message: '이미 존재하는 work item id입니다.',
    }
  }

  if (payload.parentWorkItemId && !db.workItems.some((item) => item.workItemId === payload.parentWorkItemId)) {
    return {
      status: 'error' as const,
      message: '부모 work item을 찾을 수 없습니다.',
    }
  }

  if (priority < 1 || priority > 5) {
    return {
      status: 'error' as const,
      message: 'priority는 1에서 5 사이여야 합니다.',
    }
  }

  if (weight < 0) {
    return {
      status: 'error' as const,
      message: 'weight는 0 이상이어야 합니다.',
    }
  }

  if (progress < 0 || progress > 100) {
    return {
      status: 'error' as const,
      message: 'progress는 0에서 100 사이여야 합니다.',
    }
  }

  if (payload.startDate && payload.dueDate && payload.dueDate < payload.startDate) {
    return {
      status: 'error' as const,
      message: '마감일은 시작일보다 빠를 수 없습니다.',
    }
  }

  db.workItems.push({
    workItemId,
    ownerNodeId: payload.ownerNodeId,
    ownerUserId: ownerUser.userId,
    title,
    description: payload.description?.trim() ?? '',
    status: payload.status ?? 'todo',
    priority,
    weight,
    progress,
    ...(payload.startDate ? { startDate: payload.startDate } : {}),
    ...(payload.dueDate ? { dueDate: payload.dueDate } : {}),
    ...(payload.parentWorkItemId ? { parentWorkItemId: payload.parentWorkItemId } : {}),
    createdAt: nowIso(),
  })

  writeWorkspaceDb(db)

  return {
    status: 'success' as const,
    workItemId,
  }
}

export async function updateWorkItem(payload: UpdateWorkItemRequest) {
  if (isServerDataSource()) {
    return updateWorkItemOnServer(payload)
  }

  await delay()

  const db = readWorkspaceDb()
  const item = db.workItems.find((candidate) => candidate.workItemId === payload.workItemId)

  if (!item) {
    return {
      status: 'error' as const,
      message: '수정할 업무를 찾을 수 없습니다.',
    }
  }

  const title = payload.title?.trim()
  const description = payload.description?.trim()
  const priority = payload.priority ?? item.priority
  const weight = payload.weight ?? item.weight
  const progress = payload.progress ?? item.progress

  if (title !== undefined && !title) {
    return {
      status: 'error' as const,
      message: '업무 제목은 필수입니다.',
    }
  }

  if (priority < 1 || priority > 5) {
    return {
      status: 'error' as const,
      message: 'priority는 1에서 5 사이여야 합니다.',
    }
  }

  if (weight < 0) {
    return {
      status: 'error' as const,
      message: 'weight는 0 이상이어야 합니다.',
    }
  }

  if (progress < 0 || progress > 100) {
    return {
      status: 'error' as const,
      message: 'progress는 0에서 100 사이여야 합니다.',
    }
  }

  if (payload.startDate && payload.dueDate && payload.dueDate < payload.startDate) {
    return {
      status: 'error' as const,
      message: '마감일은 시작일보다 빠를 수 없습니다.',
    }
  }

  if (title !== undefined) {
    item.title = title
  }

  if (description !== undefined) {
    item.description = description
  }

  if (payload.status) {
    item.status = payload.status
  }

  item.priority = priority
  item.weight = weight
  item.progress = progress

  if (payload.startDate !== undefined) {
    if (payload.startDate) {
      item.startDate = payload.startDate
    } else {
      delete item.startDate
    }
  }

  if (payload.dueDate !== undefined) {
    if (payload.dueDate) {
      item.dueDate = payload.dueDate
    } else {
      delete item.dueDate
    }
  }

  writeWorkspaceDb(db)

  return {
    status: 'success' as const,
    workItemId: item.workItemId,
  }
}

export async function claimWorkItem(payload: ClaimWorkItemRequest) {
  if (isServerDataSource()) {
    return {
      status: 'error' as const,
      message: '서버 API에는 아직 업무 소유권 변경 엔드포인트가 없습니다.',
    }
  }

  await delay()

  const db = readWorkspaceDb()
  const item = db.workItems.find((candidate) => candidate.workItemId === payload.workItemId)
  const owner = db.users.find((user) => user.userId === payload.ownerUserId)

  if (!item || !owner) {
    return {
      status: 'error' as const,
      message: '가져올 업무나 사용자를 찾을 수 없습니다.',
    }
  }

  item.ownerUserId = owner.userId
  writeWorkspaceDb(db)

  return {
    status: 'success' as const,
    workItemId: item.workItemId,
  }
}
