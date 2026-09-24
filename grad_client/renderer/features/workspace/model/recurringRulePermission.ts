import { getEffectiveAuthorityBitSet } from './effectiveAuthority'
import type { RecurringRuleRecord } from './recurringRuleTypes'
import type { WorkspaceSnapshot } from './types'

/** WI_PERSONAL_CHANGE (bit 8) — 본인 work-item/일정 생성 및 변경 */
const PERSONAL_CHANGE_BIT = 8
/** WI_OTHERS_CHANGE (bit 11) — 다른 사용자 work-item/일정 변경 및 삭제 */
const OTHERS_CHANGE_BIT = 11

type RecurringRuleAuthorityTarget = Pick<
  RecurringRuleRecord,
  'ownerNodeId' | 'creatorUserId' | 'assigneeUserId'
>

/**
 * 정기 일정 수정/삭제/복구 가능 여부.
 *
 * DB 의 update/delete/restore_recurring_rule 과 같은 기준을 쓴다.
 * - 내가 생성자이거나 담당자면: 해당 노드에 WI_PERSONAL_CHANGE 필요
 * - 아니면: 해당 노드에 WI_OTHERS_CHANGE 필요
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

  const isOwnerSide = rule.creatorUserId === userId || rule.assigneeUserId === userId
  const authorityBits = getEffectiveAuthorityBitSet(userId, rule.ownerNodeId, snapshot)

  return authorityBits.has(isOwnerSide ? PERSONAL_CHANGE_BIT : OTHERS_CHANGE_BIT)
}

/**
 * 정기 일정 생성 가능 여부.
 *
 * DB create_recurring_rule 과 같은 기준으로 해당 노드에 WI_PERSONAL_CHANGE(bit 8)가 필요하다.
 */
export function canCreateRecurringRule(
  nodeId: number,
  userId: string | null | undefined,
  snapshot: WorkspaceSnapshot,
) {
  if (!userId || !Number.isFinite(nodeId)) {
    return false
  }

  return getEffectiveAuthorityBitSet(userId, nodeId, snapshot).has(PERSONAL_CHANGE_BIT)
}
