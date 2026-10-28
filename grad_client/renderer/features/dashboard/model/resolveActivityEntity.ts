import type { ActivityRecord, WorkItemRecord } from '../../workspace/model/types'
import type { RecurringRuleRecord } from '../../workspace/model/recurringRuleTypes'

type WorkItemIdentity = Pick<WorkItemRecord, 'workItemId'>
type RuleIdentity = Pick<RecurringRuleRecord, 'ruleId' | 'ownerNodeId'>

function readRuleKey(nodeId: number, ruleId: string | number) {
  return `${nodeId}:${String(ruleId)}`
}

export function buildWorkItemIdSet(workItems: ReadonlyArray<WorkItemIdentity>) {
  return new Set(workItems.map((item) => item.workItemId))
}

export function isLegacyScheduleCandidateWithIds(
  activity: ActivityRecord,
  workItemIds: ReadonlySet<string>,
) {
  return activity.entityType.toUpperCase() === 'WORK_ITEM'
    && /^[1-9]\d*$/.test(activity.entityId)
    && !activity.fieldName
    && ['inserted', 'created', 'updated', 'deleted', 'restored'].includes(activity.actionType.toLowerCase())
    && !workItemIds.has(activity.entityId)
}

export function isLegacyScheduleCandidate(activity: ActivityRecord, workItems: Array<Pick<WorkItemRecord, 'workItemId'>>) {
  return isLegacyScheduleCandidateWithIds(activity, buildWorkItemIdSet(workItems))
}

export function resolveActivityEntity(activity: ActivityRecord, rules: Array<RuleIdentity>, workItems: Array<WorkItemIdentity>): ActivityRecord {
  if (!isLegacyScheduleCandidate(activity, workItems)) return activity
  const rule = rules.find((candidate) => String(candidate.ruleId) === activity.entityId && candidate.ownerNodeId === activity.nodeId)
  return rule ? { ...activity, entityType: 'RECURRING_RULE' } : activity
}

export function resolveActivityEntities(
  activities: ReadonlyArray<ActivityRecord>,
  rules: ReadonlyArray<RuleIdentity>,
  workItems: ReadonlyArray<WorkItemIdentity>,
): ActivityRecord[] {
  const workItemIds = buildWorkItemIdSet(workItems)
  const rulesByKey = new Map<string, RuleIdentity>()

  rules.forEach((rule) => {
    const key = readRuleKey(rule.ownerNodeId, rule.ruleId)
    if (!rulesByKey.has(key)) {
      rulesByKey.set(key, rule)
    }
  })

  return activities.map((activity) => {
    if (!isLegacyScheduleCandidateWithIds(activity, workItemIds)) {
      return activity
    }

    const rule = rulesByKey.get(readRuleKey(activity.nodeId, activity.entityId))
    return rule ? { ...activity, entityType: 'RECURRING_RULE' } : activity
  })
}
