import type { UpdateWorkItemRequest } from '../../workspace/model/types'
import type { WorkItemCreateFormState } from '../hooks/useWorkItemCreateForm'

export function createWorkItemUpdatePayload(
  workItemId: string,
  initial: WorkItemCreateFormState,
  current: WorkItemCreateFormState,
): UpdateWorkItemRequest {
  const payload: UpdateWorkItemRequest = { workItemId }

  if (current.title !== initial.title) payload.title = current.title
  if (current.description !== initial.description) payload.description = current.description
  if (current.categoryId !== initial.categoryId) payload.category = current.categoryId || undefined
  if (current.hidden !== initial.hidden) payload.hidden = current.hidden
  if (current.status !== initial.status) payload.status = current.status
  if (current.priority !== initial.priority) payload.priority = Number(current.priority)
  if (current.weight !== initial.weight) payload.weight = Number(current.weight)
  if (current.progress !== initial.progress) payload.progress = Number(current.progress)
  if (current.startDate !== initial.startDate) payload.startDate = current.startDate
  if (current.dueDate !== initial.dueDate) payload.dueDate = current.dueDate

  return payload
}

/**
 * 수정 페이지에서 서버로 보낼 변경 사항이 실제로 있는지 판단한다.
 * 담당자 변경은 수정 페이로드가 아니라 별도 배정 경로(claimWorkItem)로 처리되므로 함께 확인한다.
 */
export function hasWorkItemChanges(
  workItemId: string,
  initial: WorkItemCreateFormState,
  current: WorkItemCreateFormState,
): boolean {
  const payload = createWorkItemUpdatePayload(workItemId, initial, current)

  if (Object.keys(payload).length > 1) {
    return true
  }

  return current.ownerUserId !== initial.ownerUserId
}
