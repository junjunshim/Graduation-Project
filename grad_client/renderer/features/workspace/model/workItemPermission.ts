import { getEffectiveAuthorityBitSet } from './effectiveAuthority'
import type { WorkItemRecord, WorkspaceSnapshot } from './types'

/** WI_PERSONAL_CHANGE (bit 8) — 본인 work-item 생성 및 변경 */
const PERSONAL_CHANGE_BIT = 8
/** WI_HIDDEN_CHANGE (bit 9) — 숨김 속성 work-item 변경 및 삭제 */
const HIDDEN_CHANGE_BIT = 9
/** WI_OTHERS_CHANGE (bit 11) — 다른 사용자 work-item 변경 및 삭제 */
const OTHERS_CHANGE_BIT = 11

type WorkItemAuthorityTarget = Pick<WorkItemRecord, 'ownerNodeId' | 'ownerUserId' | 'hidden'>

/**
 * 업무 수정 가능 여부.
 *
 * DB 의 update_work_item 과 같은 기준을 쓴다.
 * - 항상 해당 노드에 WI_PERSONAL_CHANGE(bit 8) 필요
 * - 담당자가 내가 아니면 추가로 WI_OTHERS_CHANGE(bit 11) 필요
 * - 현재 숨김 속성 업무라면 추가로 WI_HIDDEN_CHANGE(bit 9) 필요
 * - DENY(bit 23) 가 켜져 있으면 getEffectiveAuthorityBitSet 이 빈 집합을 돌려주므로 항상 불가
 */
export function canEditWorkItem(
  item: WorkItemAuthorityTarget,
  userId: string | null | undefined,
  snapshot: WorkspaceSnapshot,
) {
  if (!userId) {
    return false
  }

  const authorityBits = getEffectiveAuthorityBitSet(userId, item.ownerNodeId, snapshot)

  if (!authorityBits.has(PERSONAL_CHANGE_BIT)) {
    return false
  }

  if (item.ownerUserId !== userId && !authorityBits.has(OTHERS_CHANGE_BIT)) {
    return false
  }

  if (item.hidden && !authorityBits.has(HIDDEN_CHANGE_BIT)) {
    return false
  }

  return true
}

/**
 * 업무 삭제(휴지통 이동) 가능 여부.
 *
 * DB 의 delete_work_item 과 같은 기준을 쓴다.
 * - 숨김 속성 업무면 WI_HIDDEN_CHANGE(bit 9) 필요
 * - 담당자가 내가 아니면 WI_OTHERS_CHANGE(bit 11), 내 업무면 WI_PERSONAL_CHANGE(bit 8) 필요
 */
export function canDeleteWorkItem(
  item: WorkItemAuthorityTarget,
  userId: string | null | undefined,
  snapshot: WorkspaceSnapshot,
) {
  if (!userId) {
    return false
  }

  const authorityBits = getEffectiveAuthorityBitSet(userId, item.ownerNodeId, snapshot)

  if (item.hidden && !authorityBits.has(HIDDEN_CHANGE_BIT)) {
    return false
  }

  const requiredBit = item.ownerUserId !== userId ? OTHERS_CHANGE_BIT : PERSONAL_CHANGE_BIT

  return authorityBits.has(requiredBit)
}

/**
 * 휴지통 업무 복구 가능 여부.
 *
 * DB 의 restore_work_item 과 같은 기준을 쓴다.
 * - 담당자가 내가 아니면 WI_OTHERS_CHANGE(bit 11), 내 업무면 WI_PERSONAL_CHANGE(bit 8) 필요
 */
export function canRestoreWorkItem(
  item: WorkItemAuthorityTarget,
  userId: string | null | undefined,
  snapshot: WorkspaceSnapshot,
) {
  if (!userId) {
    return false
  }

  const authorityBits = getEffectiveAuthorityBitSet(userId, item.ownerNodeId, snapshot)
  const requiredBit = item.ownerUserId !== userId ? OTHERS_CHANGE_BIT : PERSONAL_CHANGE_BIT

  return authorityBits.has(requiredBit)
}

/** 업무 수정/삭제/복구 권한을 한 번에 계산한다. */
export function getWorkItemPermissions(
  item: WorkItemAuthorityTarget,
  userId: string | null | undefined,
  snapshot: WorkspaceSnapshot,
) {
  return {
    canEdit: canEditWorkItem(item, userId, snapshot),
    canDelete: canDeleteWorkItem(item, userId, snapshot),
    canRestore: canRestoreWorkItem(item, userId, snapshot),
  }
}
