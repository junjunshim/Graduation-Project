import { selectWorkspaceRoot } from '../../workspace/data/workspaceDirectorySelection'
import type { LiveNotificationPayload } from '../../workspace/data/workspaceCacheEvents'
import { readWorkspaceDb } from '../../workspace/data/localStore'
import { showToast } from '../data/toastEvents'

export function navigateNotification(
  notification: Pick<
    LiveNotificationPayload,
    'node_id' | 'link_url' | 'entity_type' | 'entity_id' | 'action'
  >,
  navigate: (path: string) => void,
  userId?: string,
) {
  const isDirectlyDeleted = notification.action === 'deleted'
  const entityType = notification.entity_type
  const entityId = notification.entity_id

  // 1. 로컬 캐시에서 해당 항목이 실제로 삭제되었는지(isDeleted === true 또는 캐시에서 이미 삭제됨) 확인
  let isAlreadyDeleted = isDirectlyDeleted
  if (!isAlreadyDeleted && entityId) {
    try {
      const db = readWorkspaceDb()
      if (entityType === 'WORK_ITEM' || entityType === 'COMMENT' || entityType === 'FILE') {
        const item = db.workItems.find((w) => w.workItemId === entityId)
        if (item && item.isDeleted) {
          isAlreadyDeleted = true
        }
      } else if (entityType === 'NODE') {
        const node = db.nodes.find((n) => String(n.id) === String(entityId))
        if (node && node.isDeleted) {
          isAlreadyDeleted = true
        }
      }
    } catch {
      // 캐시 읽기 실패 시 기본값 유지
    }
  }

  // 2. 삭제된 항목에 대한 알림일 경우: 상세 화면 진입 차단 & 타임라인으로 안전 이동 & 토스트 안내
  if (isAlreadyDeleted) {
    const itemLabel =
      entityType === 'WORK_ITEM'
        ? '업무'
        : entityType === 'NODE'
        ? '워크스페이스'
        : entityType === 'FILE'
        ? '파일'
        : entityType === 'COMMENT'
        ? '댓글'
        : '항목'

    showToast({
      title: '삭제된 항목',
      content: `이미 삭제된 ${itemLabel}입니다. 타임라인으로 이동합니다.`,
      node_id: notification.node_id,
      created_at: new Date().toISOString(),
    })

    if (notification.node_id != null) {
      selectWorkspaceRoot(String(notification.node_id), false, userId)
      navigate(`/workspace?nodeId=${notification.node_id}&view=timeline`)
    } else {
      navigate('/workspace')
    }
    return
  }

  // 3. 정상 항목: 워크스페이스 세션 전환 및 지정된 link_url로 이동
  if (notification.node_id != null) {
    selectWorkspaceRoot(String(notification.node_id), false, userId)
  }

  const targetUrl =
    notification.link_url ||
    (notification.node_id ? `/workspace?nodeId=${notification.node_id}` : '/workspace')
  navigate(targetUrl)
}
