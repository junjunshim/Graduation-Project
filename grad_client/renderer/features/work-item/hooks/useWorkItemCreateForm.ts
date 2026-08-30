import { useEffect, useMemo, useState } from 'react'
import { getWorkItemComposerContext } from '../../workspace/queries/workItemComposer'
import { isServerDataSource } from '../../workspace/data/workspaceMode'
import type { WorkItemStatus } from '../../workspace/model/types'
import type { WorkItemTagId } from '../../workspace/model/workItemTags'

export type WorkItemCreateFormState = {
  categoryId: WorkItemTagId | ''
  ownerNodeId: string
  ownerUserId: string
  title: string
  parentWorkItemId: string
  description: string
  status: WorkItemStatus
  priority: string
  weight: string
  progress: string
  startDate: string
  dueDate: string
}

const initialForm: WorkItemCreateFormState = {
  categoryId: '',
  ownerNodeId: '',
  ownerUserId: '',
  title: '',
  parentWorkItemId: '',
  description: '',
  status: 'todo',
  priority: '3',
  weight: '1',
  progress: '0',
  startDate: '',
  dueDate: '',
}

export function useWorkItemCreateForm(userId?: string) {
  const [form, setForm] = useState<WorkItemCreateFormState>(initialForm)
  const selectedNodeId = form.ownerNodeId ? Number(form.ownerNodeId) : undefined
  const enforceServerCreateContract = isServerDataSource()
  const composer = useMemo(
    () => getWorkItemComposerContext(
      userId,
      selectedNodeId,
      undefined,
      { enforceServerCreateContract },
    ),
    [enforceServerCreateContract, selectedNodeId, userId],
  )

  useEffect(() => {
    if (!composer) {
      return
    }

    setForm((current) => {
      const nextNodeId = current.ownerNodeId || (composer.selectedNode ? String(composer.selectedNode.id) : '')
      const nextUserId =
        composer.assignableUsers.some((user) => user.userId === current.ownerUserId)
          ? current.ownerUserId
          : composer.assignableUsers[0]?.userId ?? ''

      const nextParentId =
        current.parentWorkItemId &&
        composer.availableParentItems.some((item) => item.workItemId === current.parentWorkItemId)
          ? current.parentWorkItemId
          : ''

      if (
        nextNodeId === current.ownerNodeId &&
        nextUserId === current.ownerUserId &&
        nextParentId === current.parentWorkItemId
      ) {
        return current
      }

      return {
        ...current,
        ownerNodeId: nextNodeId,
        ownerUserId: nextUserId,
        parentWorkItemId: nextParentId,
      }
    })
  }, [composer])

  function setField<Key extends keyof WorkItemCreateFormState>(field: Key, value: WorkItemCreateFormState[Key]) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  return {
    composer,
    form,
    setField,
  }
}
