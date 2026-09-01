import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkItemCreateFormState } from '../renderer/features/work-item/hooks/useWorkItemCreateForm.js'
import { createWorkItemUpdatePayload } from '../renderer/features/work-item/model/workItemUpdatePayload.js'

const compactInitialForm: WorkItemCreateFormState = {
  categoryId: '',
  ownerNodeId: '10',
  ownerUserId: 'server-owner-unknown',
  title: '기존 제목',
  parentWorkItemId: '',
  description: '',
  status: 'todo',
  priority: '3',
  weight: '1',
  progress: '0',
  startDate: '',
  dueDate: '',
}

test('editing a compact server work item sends only fields the user actually changed', () => {
  const titleOnly = {
    ...compactInitialForm,
    title: '바뀐 제목',
  }

  assert.deepEqual(
    createWorkItemUpdatePayload('WI-10', compactInitialForm, titleOnly),
    {
      workItemId: 'WI-10',
      title: '바뀐 제목',
    },
  )

  const detailedChanges = {
    ...compactInitialForm,
    description: '새 설명',
    priority: '5',
    progress: '80',
    dueDate: '2026-09-01',
  }

  assert.deepEqual(
    createWorkItemUpdatePayload('WI-10', compactInitialForm, detailedChanges),
    {
      workItemId: 'WI-10',
      description: '새 설명',
      priority: 5,
      progress: 80,
      dueDate: '2026-09-01',
    },
  )
})
