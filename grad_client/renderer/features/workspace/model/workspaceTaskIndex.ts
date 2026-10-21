import type { WorkItemStatus } from './types'

export type TaskMemberIdentity = {
  userId: string
  name: string
  email?: string
}

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
