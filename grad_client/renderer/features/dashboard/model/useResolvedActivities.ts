import { useEffect, useState } from 'react'
import type { ActivityRecord, WorkItemRecord } from '../../workspace/model/types'
import type { RecurringRuleRecord } from '../../workspace/model/recurringRuleTypes'
import { fetchRecurringRules } from '../../workspace/data/recurringRuleService'
import { subscribeToRecurringCache } from '../../workspace/data/workspaceCacheEvents'
import { isLegacyScheduleCandidate, resolveActivityEntity } from './resolveActivityEntity'

export function useResolvedActivities(activities: ActivityRecord[], workItems: WorkItemRecord[]) {
  const [rules, setRules] = useState<RecurringRuleRecord[]>([])
  const candidateKey = activities.filter((activity) => isLegacyScheduleCandidate(activity, workItems))
    .map((activity) => `${activity.nodeId}:${activity.id}:${activity.entityId}`).sort().join(',')

  useEffect(() => {
    let disposed = false
    let requestId = 0
    const nodeIds = [...new Set(candidateKey.split(',').filter(Boolean).map((key) => Number(key.split(':')[0])))]
    const reload = async () => {
      const request = ++requestId
      const results = await Promise.allSettled(nodeIds.map((nodeId) => fetchRecurringRules(nodeId, true)))
      if (!disposed && request === requestId) {
        setRules(results.flatMap((result) => result.status === 'fulfilled' ? result.value : []))
      }
    }
    void reload()
    const unsubscribe = subscribeToRecurringCache((event) => {
      if (!event.nodeId || nodeIds.includes(event.nodeId)) void reload()
    })
    return () => { disposed = true; unsubscribe() }
  }, [candidateKey])

  return activities.map((activity) => resolveActivityEntity(activity, rules, workItems))
}
