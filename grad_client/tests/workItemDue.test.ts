import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getWorkItemDueScheduleInfo,
  isWorkItemDueSoon,
} from '../renderer/features/workspace/model/workItemDue.js'
import type { WorkItemRecord } from '../renderer/features/workspace/model/types.js'

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

const today = Date.UTC(2026, 9, 21)

test('overdue work items show how many days have passed', () => {
  const info = getWorkItemDueScheduleInfo(
    createWorkItem({ dueDate: '2026-10-20' }),
    today,
  )

  assert.equal(info.scheduleType, 'overdue')
  assert.equal(info.label, '1일 지남')
  assert.equal(info.dayDistance, -1)
})

test('a work item due today is due soon', () => {
  const info = getWorkItemDueScheduleInfo(
    createWorkItem({ dueDate: '2026-10-21' }),
    today,
  )

  assert.equal(info.scheduleType, 'dueSoon')
  assert.equal(info.label, '오늘 마감')
  assert.equal(info.dayDistance, 0)
})

test('the seventh day is still due soon and the eighth day has plenty of time', () => {
  const seventhDay = getWorkItemDueScheduleInfo(
    createWorkItem({ dueDate: '2026-10-28' }),
    today,
  )
  const eighthDay = getWorkItemDueScheduleInfo(
    createWorkItem({ dueDate: '2026-10-29' }),
    today,
  )

  assert.equal(seventhDay.scheduleType, 'dueSoon')
  assert.equal(seventhDay.dayDistance, 7)
  assert.equal(eighthDay.scheduleType, 'plenty')
  assert.equal(eighthDay.dayDistance, 8)
})

test('completed and undated work items do not receive a schedule type', () => {
  const completed = getWorkItemDueScheduleInfo(
    createWorkItem({ status: 'done', dueDate: '2026-10-20' }),
    today,
  )
  const undated = getWorkItemDueScheduleInfo(createWorkItem(), today)

  assert.equal(completed.scheduleType, 'none')
  assert.equal(completed.label, '완료됨')
  assert.equal(undated.scheduleType, 'none')
  assert.equal(undated.label, '마감 미정')
})

test('due soon checks use the supplied workspace day', () => {
  const item = createWorkItem({ dueDate: '2026-10-28' })

  assert.equal(isWorkItemDueSoon(item, today), true)
  assert.equal(isWorkItemDueSoon(item, Date.UTC(2026, 9, 20)), false)
})
