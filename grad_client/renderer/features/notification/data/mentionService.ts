import { apiRequest } from '../../workspace/data/server/apiClient'

/**
 * 멘션 알림 읽음 처리(PATCH /api/users/notifications/read).
 * 서버 반영에 성공한 경우에만 true 를 반환한다. 실패하면 조용히 무시한다.
 */
export async function markMentionAsRead(mentionId: number): Promise<boolean> {
  try {
    await apiRequest<unknown>('/api/users/notifications/read', {
      method: 'PATCH',
      body: { mention_id: mentionId },
    })
    return true
  } catch {
    // 오프라인이거나 이미 읽음 처리된 경우가 있다. 로컬 캐시는 건드리지 않는다.
    return false
  }
}