import type { LiveNotificationPayload } from '../../workspace/data/workspaceCacheEvents'
import type { WorkItemRecord } from '../../workspace/model/types'
import { formatActivityMessage, formatMentionMessage } from '../../dashboard/model/activityFormatter.js'
import { readWorkspaceDb } from '../../workspace/data/localStore.js'

export type NotificationMessageDeps = {
  workItems?: WorkItemRecord[]
}

function resolveWorkItemTitle(workItemId: string, deps: NotificationMessageDeps): string | undefined {
  const fromDeps = deps.workItems?.find((item) => item.workItemId === workItemId)?.title
  if (fromDeps) {
    return fromDeps
  }
  if (deps.workItems) {
    return undefined
  }

  try {
    return readWorkspaceDb().workItems.find((item) => item.workItemId === workItemId)?.title
  } catch {
    return undefined
  }
}

/**
 * 알림 1건의 본문 문장을 만든다.
 * - 최근 활동 피드·업무 상세 타임라인과 완전히 같은 문장을 사용한다.
 * - 서버(또는 과거 localStorage)가 만든 content 는 원시 필드가 없을 때만 폴백으로 쓴다.
 */
export function formatNotificationMessage(
  notification: LiveNotificationPayload,
  deps: NotificationMessageDeps = {},
): string {
  const actor = (notification.actor_name ?? '').trim() || '사용자'
  const entityType = (notification.entity_type ?? '').toUpperCase()
  const entityId = (notification.entity_id ?? '').trim()
  const targetName = (notification.target_name ?? '').trim()

  if ((notification.sub_type ?? '').toUpperCase() === 'MENTION') {
    return formatMentionMessage((notification.work_item_id ?? '').trim() || entityId, {
      actorName: actor,
      resolveWorkItemTitle: (workItemId) => resolveWorkItemTitle(workItemId, deps),
    })
  }

  if (notification.can_view_detail === false) {
    const commentCode = /^Comment on\s+(.+)$/i.exec(targetName)?.[1]?.trim() ?? ''
    const code =
      (notification.work_item_id ?? '').trim() ||
      (entityType === 'WORK_ITEM' ? entityId : '') ||
      commentCode

    return code
      ? `${actor}님이 업무[${code}] 관련 활동을 수행했습니다.`
      : `${actor}님이 업무 관련 활동을 수행했습니다.`
  }

  if (!targetName) {
    return (notification.content ?? '').trim() || `${actor}님이 활동을 수행했습니다.`
  }

  return formatActivityMessage(
    {
      id: notification.notification_id ?? 0,
      nodeId: notification.node_id ?? 0,
      actorUserId: notification.actor_user_id ?? '',
      actorName: (notification.actor_name ?? '').trim(),
      entityType,
      entityId,
      targetName,
      actionType: notification.action ?? '',
      fieldName: notification.field_name ?? null,
      oldValue: notification.old_value ?? null,
      newValue: notification.new_value ?? null,
      createdAt: notification.created_at,
    },
    {
      actorName: actor,
      targetName,
      resolveWorkItemTitle: (workItemId) => resolveWorkItemTitle(workItemId, deps),
    },
  )
}