import type { ActivityRecord, WorkItemRecord } from '../../workspace/model/types'
import type { RecurringRuleRecord } from '../../workspace/model/recurringRuleTypes'

export function isLegacyScheduleCandidate(activity: ActivityRecord, workItems: Array<Pick<WorkItemRecord, 'workItemId'>>) {
  return activity.entityType.toUpperCase() === 'WORK_ITEM'
    && /^[1-9]\d*$/.test(activity.entityId)
    && !activity.fieldName
    && ['inserted', 'created', 'updated', 'deleted', 'restored'].includes(activity.actionType.toLowerCase())
    && !workItems.some((item) => item.workItemId === activity.entityId)
}

export function resolveActivityEntity(activity: ActivityRecord, rules: Array<Pick<RecurringRuleRecord, 'ruleId' | 'ownerNodeId'>>, workItems: Array<Pick<WorkItemRecord, 'workItemId'>>): ActivityRecord {
  if (!isLegacyScheduleCandidate(activity, workItems)) return activity
  const rule = rules.find((candidate) => String(candidate.ruleId) === activity.entityId && candidate.ownerNodeId === activity.nodeId)
  return rule ? { ...activity, entityType: 'RECURRING_RULE' } : activity
}
