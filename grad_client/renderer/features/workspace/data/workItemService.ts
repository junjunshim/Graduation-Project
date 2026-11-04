import type { CreateWorkItemRequest, UpdateWorkItemRequest } from '../model/types'
import {
  addWorkItemCommentOnServer,
  createWorkItemOnServer,
  fetchWorkItemDetailOnServer,
  updateWorkItemOnServer,
  type WorkItemDetailResult,
} from './serverWorkspace'
import { createServerEntityId } from './server/serverId'
import { invalidateQueryCache, queryWithCache } from './queryCache.js'

const WORK_ITEM_DETAIL_CACHE_TTL_MS = 30_000

export function invalidateWorkItemDetailCache(workItemId?: string) {
  invalidateQueryCache(
    workItemId && workItemId.trim()
      ? `workItem:detail:${workItemId.trim()}`
      : 'workItem:detail:',
  )
}

export function getNextGeneratedWorkItemId() {
  return createServerEntityId('WI')
}

export async function createWorkItem(payload: CreateWorkItemRequest) {
  const result = await createWorkItemOnServer(payload)
  invalidateWorkItemDetailCache(payload.workItemId)
  if (payload.parentWorkItemId) {
    invalidateWorkItemDetailCache(payload.parentWorkItemId)
  }
  return result
}

export async function updateWorkItem(payload: UpdateWorkItemRequest) {
  const result = await updateWorkItemOnServer(payload)
  invalidateWorkItemDetailCache(payload.workItemId)
  if (payload.parentWorkItemId) {
    invalidateWorkItemDetailCache(payload.parentWorkItemId)
  }
  return result
}

export async function deleteWorkItem(workItemId: string) {
  const { deleteWorkItemOnServer } = await import('./server/serverWorkspace')
  const result = await deleteWorkItemOnServer(workItemId)
  invalidateWorkItemDetailCache(workItemId)
  return result
}

export async function fetchWorkItemDetail(
  workItemId: string,
  options: { forceRefresh?: boolean } = {},
): Promise<WorkItemDetailResult> {
  const normalizedId = workItemId.trim()
  return queryWithCache(
    `workItem:detail:${normalizedId}`,
    () => fetchWorkItemDetailOnServer(normalizedId),
    { ttlMs: WORK_ITEM_DETAIL_CACHE_TTL_MS, forceRefresh: options.forceRefresh },
  )
}

export async function addWorkItemComment(workItemId: string, content: string) {
  const result = await addWorkItemCommentOnServer(workItemId, content)
  if (result.status !== 'error') {
    invalidateWorkItemDetailCache(workItemId)
  }
  return result
}

export type RestoreWorkItemOptions = {
  cascade?: boolean
  newParentId?: string
}

export async function restoreWorkItem(workItemId: string, options: RestoreWorkItemOptions = { cascade: true }) {
  const { restoreWorkItemOnServer } = await import('./server/serverWorkspace')
  const result = await restoreWorkItemOnServer(workItemId, options)
  invalidateWorkItemDetailCache(workItemId)
  if (options.newParentId) {
    invalidateWorkItemDetailCache(options.newParentId)
  }
  return result
}
