import assert from 'node:assert/strict'
import test from 'node:test'
import { buildWorkspaceOverviewTaskSummary } from '../renderer/features/workspace/model/workspaceOverviewSummary.js'
import type { WorkItemRecord } from '../renderer/features/workspace/model/types.js'

const today = Date.UTC(2026, 9, 21)

function createWorkItem(overrides: Partial<WorkItemRecord> = {}): WorkItemRecord {
  return {
    workItemId: 'WI-1',
    ownerNodeId: 1,
    ownerUserId: 'user@example.com',
    title: 'Task',
    description: '',
    status: 'todo',
    priority: 3,
    weight: 1,
    progress: 0,
    createdAt: '2026-10-01T00:00:00Z',
    ...overrides,
  }
}

test('overview summary counts active tasks and sorts pending items once', () => {
  const summary = buildWorkspaceOverviewTaskSummary(
    [
      createWorkItem({ workItemId: 'A', dueDate: '2026-10-21' }),
      createWorkItem({ workItemId: 'B', status: 'in-progress', dueDate: '2026-10-20' }),
      createWorkItem({ workItemId: 'C', status: 'done', dueDate: '2026-10-19' }),
      createWorkItem({ workItemId: 'D', status: 'in-progress' }),
      createWorkItem({ workItemId: 'E', isDeleted: true, dueDate: '2026-10-21' }),
    ],
    today,
  )

  assert.equal(summary.tasks.length, 4)
  assert.equal(summary.completedCount, 1)
  assert.equal(summary.inProgressCount, 2)
  assert.equal(summary.todoCount, 1)
  assert.equal(summary.completionRate, 25)
  assert.deepEqual(summary.pending.map((item) => item.workItemId), ['B', 'A', 'D'])
  assert.deepEqual(
    summary.priorityTasks.map((task) => [task.item.workItemId, task.days]),
    [['B', -1], ['A', 0]],
  )
  assert.equal(summary.overdueCount, 1)
})

test('overview summary includes overdue and six-day deadlines but not the seventh day', () => {
  const summary = buildWorkspaceOverviewTaskSummary(
    [
      createWorkItem({ workItemId: 'OVERDUE', dueDate: '2026-10-14' }),
      createWorkItem({ workItemId: 'SIX', dueDate: '2026-10-27T12:00:00' }),
      createWorkItem({ workItemId: 'SEVEN', dueDate: '2026-10-28' }),
      createWorkItem({ workItemId: 'NONE' }),
    ],
    today,
  )

  assert.deepEqual(
    summary.priorityTasks.map((task) => [task.item.workItemId, task.days]),
    [['OVERDUE', -7], ['SIX', 6]],
  )
  assert.equal(summary.overdueCount, 1)
})

test('overview summary uses title ordering for the same due date', () => {
  const summary = buildWorkspaceOverviewTaskSummary(
    [
      createWorkItem({ workItemId: 'B', title: 'Beta', dueDate: '2026-10-25' }),
      createWorkItem({ workItemId: 'A', title: 'Alpha', dueDate: '2026-10-25' }),
    ],
    today,
  )

  assert.deepEqual(summary.pending.map((item) => item.workItemId), ['A', 'B'])
})

test('overview summary handles an empty workspace', () => {
  assert.deepEqual(buildWorkspaceOverviewTaskSummary([], today), {
    tasks: [],
    pending: [],
    priorityTasks: [],
    overdueCount: 0,
    completedCount: 0,
    inProgressCount: 0,
    todoCount: 0,
    completionRate: 0,
  })
})
