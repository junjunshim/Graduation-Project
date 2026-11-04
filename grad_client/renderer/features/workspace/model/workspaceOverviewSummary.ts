import type { WorkItemRecord } from './types'
import { parseWorkspaceDay } from './workItemDue.js'

const MS_PER_DAY = 24 * 60 * 60 * 1000

export type WorkspacePriorityTask = {
  item: WorkItemRecord
  days: number
}

export type WorkspaceOverviewTaskSummary = {
  tasks: WorkItemRecord[]
  pending: WorkItemRecord[]
  priorityTasks: WorkspacePriorityTask[]
  overdueCount: number
  completedCount: number
  inProgressCount: number
  todoCount: number
  completionRate: number
}

export function buildWorkspaceOverviewTaskSummary(
  workItems: ReadonlyArray<WorkItemRecord>,
  todayTimestamp: number,
): WorkspaceOverviewTaskSummary {
  const tasks: WorkItemRecord[] = []
  const pending: WorkItemRecord[] = []
  const daysByItem = new Map<WorkItemRecord, number>()
  let completedCount = 0
  let inProgressCount = 0

  workItems.forEach((item) => {
    if (item.isDeleted) {
      return
    }

    tasks.push(item)

    if (item.status === 'done') {
      completedCount += 1
      return
    }

    pending.push(item)

    if (item.status === 'in-progress') {
      inProgressCount += 1
    }

    const dueTimestamp = parseWorkspaceDay(item.dueDate)
    if (dueTimestamp !== null) {
      daysByItem.set(item, Math.round((dueTimestamp - todayTimestamp) / MS_PER_DAY))
    }
  })

  pending.sort(
    (left, right) =>
      (left.dueDate || '9999').localeCompare(right.dueDate || '9999') ||
      left.title.localeCompare(right.title, 'ko'),
  )

  const priorityTasks: WorkspacePriorityTask[] = []
  let overdueCount = 0

  pending.forEach((item) => {
    const days = daysByItem.get(item)

    if (days === undefined) {
      return
    }

    if (days < 0) {
      overdueCount += 1
    }

    if (days < 7) {
      priorityTasks.push({ item, days })
    }
  })

  const todoCount = tasks.length - completedCount - inProgressCount

  return {
    tasks,
    pending,
    priorityTasks,
    overdueCount,
    completedCount,
    inProgressCount,
    todoCount,
    completionRate: tasks.length ? Math.round((completedCount / tasks.length) * 100) : 0,
  }
}
