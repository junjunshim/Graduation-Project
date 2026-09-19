import type { MentionRecord } from '../../workspace/model/types'

/**
 * 앱이 꺼져 있는 동안 발생한 알림 복원 규칙(확정): 멘션만, 읽지 않았고 업무가 연결된 건만, 최신순.
 * 벨에서 "전체 삭제"한 멘션은 dismissedIds 로 걸러 다시 뜨지 않게 한다.
 */
export function selectRestorableMentions(
  mentions: MentionRecord[],
  dismissedIds: ReadonlySet<number> = new Set(),
): MentionRecord[] {
  return mentions
    .filter((mention) => !mention.isRead && Boolean(mention.workItemId) && !dismissedIds.has(mention.id))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

/** 라이브 WS 알림도 notification_id = mention_id 로 내려오므로 벨 안에서 같은 ID 로 합쳐진다. */
export function mentionNotificationId(mentionId: number) {
  return `mention-${mentionId}`
}
