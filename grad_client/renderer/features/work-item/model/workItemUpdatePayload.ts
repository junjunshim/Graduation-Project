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
  if (current.status !== initial.status) payload.status = current.status
  if (current.priority !== initial.priority) payload.priority = Number(current.priority)
  if (current.weight !== initial.weight) payload.weight = Number(current.weight)
  if (current.progress !== initial.progress) payload.progress = Number(current.progress)
  if (current.startDate !== initial.startDate) payload.startDate = current.startDate
  if (current.dueDate !== initial.dueDate) payload.dueDate = current.dueDate

  return payload
}
