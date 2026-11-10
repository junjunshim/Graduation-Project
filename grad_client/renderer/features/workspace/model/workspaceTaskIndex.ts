import type { WorkItemStatus } from './types'

export type TaskMemberIdentity = {
  userId: string
  name: string
  email?: string
}

export type TimelineUserIdentity = {
  userId: string
  name: string
  email?: string
}

export type TimelineRangeEntry = {
  start: number
  endExclusive: number
}

export const TIMELINE_UNASSIGNED_NAME = '담당자 미정'

export function buildMemberNameLookup(
  members: ReadonlyArray<TaskMemberIdentity>,
): Map<string, string> {
  const lookup = new Map<string, string>()

  members.forEach((member) => {
    if (!lookup.has(member.userId)) {
      lookup.set(member.userId, member.name)
    }
    if (member.email && !lookup.has(member.email)) {
      lookup.set(member.email, member.name)
    }
  })

  return lookup
}

export function buildTimelineMemberNameLookup(
  members: ReadonlyArray<TaskMemberIdentity>,
  users: ReadonlyArray<TimelineUserIdentity> = [],
): Map<string, string> {
  const lookup = new Map<string, string>()

  members.forEach((member) => {
    if (!lookup.has(member.userId)) {
      lookup.set(member.userId, member.name)
    }
  })

  users.forEach((user) => {
    if (!lookup.has(user.userId)) {
      lookup.set(user.userId, user.name)
    }
    if (user.email && !lookup.has(user.email)) {
      lookup.set(user.email, user.name)
    }
  })

  return lookup
}

export function resolveTimelineMemberName(
  lookup: ReadonlyMap<string, string>,
  userId: string,
): string {
  return lookup.get(userId) ?? TIMELINE_UNASSIGNED_NAME
}

export function getTimelineRange(
  entries: ReadonlyArray<TimelineRangeEntry>,
  today: number,
  paddingMonths = 6,
): { start: number; end: number } {
  let earliest = today
  let latest = today

  entries.forEach((entry) => {
    if (entry.start < earliest) {
      earliest = entry.start
    }
    if (entry.endExclusive > latest) {
      latest = entry.endExclusive
    }
  })

  const earliestDate = new Date(earliest)
  const latestDate = new Date(latest)

  return {
    start: Date.UTC(earliestDate.getUTCFullYear(), earliestDate.getUTCMonth() - paddingMonths, 1),
    end: Date.UTC(latestDate.getUTCFullYear(), latestDate.getUTCMonth() + paddingMonths + 1, 1),
  }
}

export function groupWorkItemsByStatus<T extends { status: WorkItemStatus }>(
  items: ReadonlyArray<T>,
): Record<WorkItemStatus, T[]> {
  const grouped: Record<WorkItemStatus, T[]> = {
    'in-progress': [],
    todo: [],
    done: [],
  }

  items.forEach((item) => {
    const bucket = grouped[item.status]
    if (bucket) {
      bucket.push(item)
    }
  })

  return grouped
}

export type TimelineTreeItem = {
  workItemId: string
  parentWorkItemId?: string
  displayId?: number
  title: string
}

export type TimelineTree<T extends TimelineTreeItem> = {
  roots: T[]
  children: Map<string, T[]>
  orderedItems: T[]
}

/**
 * 업무 트리를 만들면서 같은 레벨의 업무를 일정 순서로 정렬한다.
 * 하위 트리에서 가장 이른 시작일을 정렬 기준으로 사용해, 계층을 유지하면서도
 * 시작일이 빠른 업무 묶음이 위쪽에 오도록 한다.
 */
export function buildChronologicalTimelineTree<T extends TimelineTreeItem>(
  items: ReadonlyArray<T>,
  startById: ReadonlyMap<string, number>,
): TimelineTree<T> {
  const itemMap = new Map(items.map((item) => [item.workItemId, item]))
  const children = new Map<string, T[]>()
  const roots: T[] = []

  items.forEach((item) => {
    const parentId = item.parentWorkItemId
    if (parentId && parentId !== item.workItemId && itemMap.has(parentId)) {
      const siblings = children.get(parentId) ?? []
      siblings.push(item)
      children.set(parentId, siblings)
    } else {
      roots.push(item)
    }
  })

  const earliestStart = new Map<string, number>()
  const resolving = new Set<string>()
  const resolveEarliestStart = (item: T): number => {
    const cached = earliestStart.get(item.workItemId)
    if (cached !== undefined) return cached
    if (resolving.has(item.workItemId)) return Number.POSITIVE_INFINITY

    resolving.add(item.workItemId)
    let earliest = startById.get(item.workItemId) ?? Number.POSITIVE_INFINITY
    children.get(item.workItemId)?.forEach((child) => {
      earliest = Math.min(earliest, resolveEarliestStart(child))
    })
    resolving.delete(item.workItemId)
    earliestStart.set(item.workItemId, earliest)
    return earliest
  }

  const compareItems = (left: T, right: T) => {
    const leftEarliest = resolveEarliestStart(left)
    const rightEarliest = resolveEarliestStart(right)
    if (leftEarliest !== rightEarliest) return leftEarliest < rightEarliest ? -1 : 1

    const leftStart = startById.get(left.workItemId) ?? Number.POSITIVE_INFINITY
    const rightStart = startById.get(right.workItemId) ?? Number.POSITIVE_INFINITY
    if (leftStart !== rightStart) return leftStart < rightStart ? -1 : 1

    const leftDisplayId = left.displayId ?? Number.MAX_SAFE_INTEGER
    const rightDisplayId = right.displayId ?? Number.MAX_SAFE_INTEGER
    if (leftDisplayId !== rightDisplayId) return leftDisplayId - rightDisplayId

    return (
      left.title.localeCompare(right.title, 'ko') ||
      left.workItemId.localeCompare(right.workItemId, 'en', { numeric: true })
    )
  }

  roots.sort(compareItems)
  children.forEach((siblings) => siblings.sort(compareItems))

  return {
    roots,
    children,
    orderedItems: [...items].sort(compareItems),
  }
}
