import type { CreateWorkItemRequest, UpdateWorkItemRequest } from '../model/types'
import {
  addWorkItemCommentOnServer,
  createWorkItemOnServer,
  fetchWorkItemDetailOnServer,
  updateWorkItemOnServer,
  type WorkItemDetailResult,
} from './serverWorkspace'
import { createServerEntityId } from './server/serverId'

export function getNextGeneratedWorkItemId() {
  return createServerEntityId('WI')
}

export async function createWorkItem(payload: CreateWorkItemRequest) {
  return createWorkItemOnServer(payload)
}

export async function updateWorkItem(payload: UpdateWorkItemRequest) {
  return updateWorkItemOnServer(payload)
}

export async function deleteWorkItem(workItemId: string) {
  const { deleteWorkItemOnServer } = await import('./server/serverWorkspace')
  return deleteWorkItemOnServer(workItemId)
}

export async function fetchWorkItemDetail(workItemId: string): Promise<WorkItemDetailResult> {
  return fetchWorkItemDetailOnServer(workItemId)
}

export async function addWorkItemComment(workItemId: string, content: string) {
  return addWorkItemCommentOnServer(workItemId, content)
}

export type RestoreWorkItemOptions = {
  cascade?: boolean
  newParentId?: string
}

export async function restoreWorkItem(workItemId: string, options: RestoreWorkItemOptions = { cascade: true }) {
  const { restoreWorkItemOnServer } = await import('./server/serverWorkspace')
  return restoreWorkItemOnServer(workItemId, options)
}
