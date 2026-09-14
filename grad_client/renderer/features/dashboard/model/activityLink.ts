import type { ActivityRecord } from '../../workspace/model/types'

export function getActivityLink(activity: Pick<ActivityRecord, 'entityType' | 'entityId' | 'nodeId' | 'targetName'>): string | null {
  switch (activity.entityType.toUpperCase()) {
    case 'RECURRING_RULE':
      return `/workspace?view=schedules&nodeId=${activity.nodeId}&ruleId=${encodeURIComponent(activity.entityId)}`
    case 'WORK_ITEM':
      return `/work-items/${encodeURIComponent(activity.entityId)}`
    case 'COMMENT': {
      const id = activity.targetName?.match(/^Comment on\s+(.+)$/i)?.[1]?.trim()
      return id ? `/work-items/${encodeURIComponent(id)}` : null
    }
    default:
      return null
  }
}
