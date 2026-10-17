import { getEffectiveAuthorityBitSet } from './effectiveAuthority'
import type { RecurringRuleRecord } from './recurringRuleTypes'
import type { WorkspaceSnapshot } from './types'

/** SCHEDULE_CHANGE (bit 19) — 정기 일정 생성 및 변경 가능 */
const SCHEDULE_CHANGE_BIT = 19

type RecurringRuleAuthorityTarget = Pick<
  RecurringRuleRecord,
  'ownerNodeId' | 'creatorUserId' | 'assigneeUserId'
>

/**
 * 정기 일정 수정/삭제/복구 가능 여부.
 *
 * DB 의 update/delete/restore_recurring_rule 과 같은 기준을 쓴다.
 * - 노드에 SCHEDULE_CHANGE(bit 19) 권한 필요
 * - DENY 비트가 켜져 있으면 getEffectiveAuthorityBitSet 이 빈 집합을 돌려주므로 항상 불가
 */
export function canManageRecurringRule(
  rule: RecurringRuleAuthorityTarget,
  userId: string | null | undefined,
  snapshot: WorkspaceSnapshot,
) {
  if (!userId) {
    return false
  }

  const authorityBits = getEffectiveAuthorityBitSet(userId, rule.ownerNodeId, snapshot)
  return authorityBits.has(SCHEDULE_CHANGE_BIT)
}

/**
 * 정기 일정 생성 가능 여부.
 *
 * DB create_recurring_rule 과 같은 기준으로 해당 노드에 SCHEDULE_CHANGE(bit 19)가 필요하다.
 */
export function canCreateRecurringRule(
  nodeId: number,
  userId: string | null | undefined,
  snapshot: WorkspaceSnapshot,
) {
  if (!userId || !Number.isFinite(nodeId)) {
    return false
  }

  return getEffectiveAuthorityBitSet(userId, nodeId, snapshot).has(SCHEDULE_CHANGE_BIT)
}
