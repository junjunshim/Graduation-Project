import { selectWorkspaceRoot } from '../../workspace/data/workspaceDirectorySelection'
import type { LiveNotificationPayload } from '../../workspace/data/workspaceCacheEvents'

export function navigateNotification(
  notification: Pick<LiveNotificationPayload, 'node_id' | 'link_url'>,
  navigate: (path: string) => void,
  userId?: string,
) {
  // 1. 노드 ID가 포함된 경우 해당 노드로 워크스페이스 세션 즉시 전환
  if (notification.node_id != null) {
    selectWorkspaceRoot(String(notification.node_id), false, userId)
  }

  // 2. 링크 URL이 있으면 해당 경로로 이동, 없으면 워크스페이스로 이동
  const targetUrl = notification.link_url || (notification.node_id ? `/workspace?nodeId=${notification.node_id}` : '/workspace')
  navigate(targetUrl)
}
