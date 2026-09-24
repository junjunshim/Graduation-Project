import { hasEffectiveAuthorityBit } from './effectiveAuthority'
import type { RecurringRuleFileRecord, RecurringRuleRecord } from './recurringRuleTypes'
import type { WorkItemFileRecord, WorkItemRecord, WorkspaceSnapshot } from './types'

/** WI_PUBLIC_VIEW (Bit 4) — 공개 업무 조회 */
const WI_PUBLIC_VIEW_BIT = 4
/** WI_HIDDEN_VIEW (Bit 6) — 숨김 업무 조회 */
const WI_HIDDEN_VIEW_BIT = 6
/** WI_PERSONAL_CHANGE (Bit 8) — 본인 업무/일정 변경 */
const WI_PERSONAL_CHANGE_BIT = 8
/** FILE_VIEW (Bit 16) — 파일 조회/다운로드 */
const FILE_VIEW_BIT = 16
/** FILE_CHANGE (Bit 17) — 파일 업로드/삭제/복구 */
const FILE_CHANGE_BIT = 17

type WorkItemFileTarget = Pick<WorkItemRecord, 'ownerNodeId' | 'ownerUserId' | 'hidden'>
type RecurringRuleFileTarget = Pick<RecurringRuleRecord, 'ownerNodeId' | 'creatorUserId' | 'assigneeUserId'>

/**
 * 업무 파일 권한. DB 함수(add_work_item_file / get_work_item_file_download /
 * delete_work_item_file / restore_work_item_file)와 같은 기준이다.
 * - 업무 담당자 본인이면 항상 허용
 * - 그 외에는 (숨김 업무면 WI_HIDDEN_VIEW, 공개 업무면 WI_PUBLIC_VIEW) 를 만족해야 한다
 */
function canReachWorkItem(
  userId: string,
  item: WorkItemFileTarget,
  snapshot: WorkspaceSnapshot,
): boolean {
  if (item.ownerUserId === userId) return true
  return hasEffectiveAuthorityBit(userId, item.ownerNodeId, item.hidden ? WI_HIDDEN_VIEW_BIT : WI_PUBLIC_VIEW_BIT, snapshot)
}

/** 업무 파일 업로드 가능 여부 */
export function canUploadWorkItemFile(
  userId: string | null | undefined,
  item: WorkItemFileTarget,
  snapshot: WorkspaceSnapshot,
): boolean {
  if (!userId) return false
  if (item.ownerUserId === userId) return true
  return canReachWorkItem(userId, item, snapshot)
    && hasEffectiveAuthorityBit(userId, item.ownerNodeId, FILE_CHANGE_BIT, snapshot)
}

/** 업무 파일 다운로드 가능 여부 */
export function canDownloadWorkItemFile(
  userId: string | null | undefined,
  item: WorkItemFileTarget,
  snapshot: WorkspaceSnapshot,
): boolean {
  if (!userId) return false
  if (item.ownerUserId === userId) return true
  return canReachWorkItem(userId, item, snapshot)
    && hasEffectiveAuthorityBit(userId, item.ownerNodeId, FILE_VIEW_BIT, snapshot)
}

/** 업무 파일 삭제/복구 가능 여부 (업로더 본인이거나 FILE_CHANGE) */
export function canChangeWorkItemFile(
  userId: string | null | undefined,
  file: Pick<WorkItemFileRecord, 'uploaderUserId'>,
  item: WorkItemFileTarget,
  snapshot: WorkspaceSnapshot,
): boolean {
  if (!userId) return false
  if (file.uploaderUserId && file.uploaderUserId === userId) return true
  return hasEffectiveAuthorityBit(userId, item.ownerNodeId, FILE_CHANGE_BIT, snapshot)
}

/** 일정 양식 파일 업로드 가능 여부 (생성자/담당자면 WI_PERSONAL_CHANGE, 그 외 FILE_CHANGE) */
export function canUploadRecurringRuleFile(
  userId: string | null | undefined,
  rule: RecurringRuleFileTarget,
  snapshot: WorkspaceSnapshot,
): boolean {
  if (!userId) return false
  const isOwnerSide = rule.creatorUserId === userId || rule.assigneeUserId === userId
  return hasEffectiveAuthorityBit(
    userId,
    rule.ownerNodeId,
    isOwnerSide ? WI_PERSONAL_CHANGE_BIT : FILE_CHANGE_BIT,
    snapshot,
  )
}

/** 일정 양식 파일 다운로드 가능 여부 (생성자면 통과, 그 외 FILE_VIEW) */
export function canDownloadRecurringRuleFile(
  userId: string | null | undefined,
  rule: RecurringRuleFileTarget,
  snapshot: WorkspaceSnapshot,
): boolean {
  if (!userId) return false
  if (rule.creatorUserId === userId) return true
  return hasEffectiveAuthorityBit(userId, rule.ownerNodeId, FILE_VIEW_BIT, snapshot)
}

/** 일정 양식 파일 삭제/복구 가능 여부 (업로더 본인이거나 FILE_CHANGE) */
export function canChangeRecurringRuleFile(
  userId: string | null | undefined,
  file: Pick<RecurringRuleFileRecord, 'uploaderUserId'>,
  rule: RecurringRuleFileTarget,
  snapshot: WorkspaceSnapshot,
): boolean {
  if (!userId) return false
  if (file.uploaderUserId && file.uploaderUserId === userId) return true
  return hasEffectiveAuthorityBit(userId, rule.ownerNodeId, FILE_CHANGE_BIT, snapshot)
}
