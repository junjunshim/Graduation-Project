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
