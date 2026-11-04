import type { LiveNotificationPayload } from '../../workspace/data/workspaceCacheEvents'
import type { WorkItemRecord } from '../../workspace/model/types'
import { formatActivityMessage, formatMentionMessage } from '../../dashboard/model/activityFormatter.js'
import { withJosa } from '../../dashboard/model/koreanParticle.js'
import { readWorkspaceDb } from '../../workspace/data/localStore.js'

export type NotificationMessageDeps = {
  workItems?: WorkItemRecord[]
}

function compactPreview(value: string | null | undefined, maxLength = 80) {
  const compact = (value ?? '').replace(/\s+/g, ' ').trim()
  if (compact.length <= maxLength) {
    return compact
  }

  return `${compact.slice(0, maxLength)}…`
}

function quoted(value: string) {
  return `‘${value}’`
}

function formatChatNotification(notification: LiveNotificationPayload) {
  const actor = (notification.actor_name ?? '').trim() || '사용자'
  const isDm = (notification.channel_type ?? '').toUpperCase() === 'DM'
  const isThread = notification.parent_message_id != null
  const channelName = (notification.channel_name ?? '').trim().replace(/^#+/, '')
  const channelLabel = isDm ? '다이렉트 메시지' : `#${channelName || '채널'} 채널`
  const preview = compactPreview(notification.content)
  const attachmentCount = Math.max(0, notification.attachment_count ?? 0)
  const attachmentNames = (notification.attachment_names ?? []).filter((name) => name.trim() !== '')

  let subject = channelLabel
  if (isThread) {
    subject = isDm ? '다이렉트 메시지의 스레드' : `${channelLabel}의 스레드`
  }

  if (preview) {
    if (isThread) {
      return `${actor}님이 ${subject}에 답글을 남겼습니다: ${quoted(preview)}`
    }
    if (isDm) {
      return `${actor}님이 다이렉트 메시지를 보냈습니다: ${quoted(preview)}`
    }
    return `${actor}님이 ${subject}에 메시지를 보냈습니다: ${quoted(preview)}`
  }

  if (attachmentCount > 0) {
    if (attachmentCount === 1 && attachmentNames[0]) {
      if (isThread) {
        return `${actor}님이 ${subject}에 파일 ${withJosa(quoted(attachmentNames[0]), '을/를')} 보냈습니다.`
      }
      if (isDm) {
        return `${actor}님이 다이렉트 메시지로 파일 ${withJosa(quoted(attachmentNames[0]), '을/를')} 보냈습니다.`
      }
      return `${actor}님이 ${subject}에 파일 ${withJosa(quoted(attachmentNames[0]), '을/를')} 보냈습니다.`
    }

    const fileLabel = attachmentCount === 1 ? '파일 1개' : `파일 ${attachmentCount}개`
    return `${actor}님이 ${subject}에 ${withJosa(fileLabel, '을/를')} 보냈습니다.`
  }

  return isThread
    ? `${actor}님이 ${subject}에 답글을 남겼습니다.`
    : `${actor}님이 ${subject}에 메시지를 보냈습니다.`
}

function formatGithubNotification(notification: LiveNotificationPayload) {
  const actor = (notification.actor_name ?? '').trim() || '사용자'
  const repo = (notification.repo_full_name ?? '').trim() || `저장소 ${notification.repo_id ?? ''}`.trim()
  const branch = (notification.branch ?? '').trim()
  const entityType = (notification.entity_type ?? '').toUpperCase()
  const action = (notification.action ?? '').toLowerCase()

  if (entityType === 'GITHUB_REPOSITORY') {
    return action === 'deleted'
      ? `${actor}님이 저장소 ${quoted(repo)} 연결을 해제했습니다.`
      : `${actor}님이 저장소 ${quoted(repo)}를 연결했습니다.`
  }

  if (entityType === 'GITHUB_BRANCH') {
    return action === 'deleted'
      ? `${actor}님이 저장소 ${quoted(repo)}의 브랜치 ${withJosa(quoted(branch), '을/를')} 삭제했습니다.`
      : `${actor}님이 저장소 ${quoted(repo)}에서 브랜치 ${withJosa(quoted(branch), '을/를')} 생성했습니다.`
  }

  if (entityType === 'GITHUB_COMMIT') {
    const commitMessage = compactPreview(notification.commit_message ?? notification.content)
    const shortSha = (notification.commit_sha ?? '').trim().slice(0, 7)
    const shaSuffix = shortSha ? ` (${shortSha})` : ''
    return `${actor}님이 저장소 ${quoted(repo)}의 ${quoted(branch)} 브랜치에 커밋 ${quoted(commitMessage)}를 생성했습니다.${shaSuffix}`
  }

  if (entityType === 'GITHUB_PUSH') {
    const count = Math.max(0, notification.pushed_commit_count ?? 0)
    return `${actor}님이 저장소 ${quoted(repo)}의 ${quoted(branch)} 브랜치를 원격에 push했습니다.${count > 0 ? ` (커밋 ${count}개)` : ''}`
  }

  return `${actor}님이 GitHub 저장소 ${quoted(repo)}를 변경했습니다.`
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
  const subType = (notification.sub_type ?? '').toUpperCase()

  if (subType === 'CHAT_MESSAGE') {
    return formatChatNotification(notification)
  }

  if (subType === 'GITHUB') {
    return formatGithubNotification(notification)
  }

  if (subType === 'MENTION') {
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
