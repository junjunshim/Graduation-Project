import { useState, useEffect, useCallback } from 'react'
import {
  subscribeToLiveNotifications,
  subscribeToWorkspaceCache,
  type LiveNotificationPayload,
} from '../../workspace/data/workspaceCacheEvents'
import { useResolvedActivities } from '../../dashboard/model/useResolvedActivities'
import { getActivityLink } from '../../dashboard/model/activityLink'
import { readWorkspaceDb, writeServerWorkspaceDb } from '../../workspace/data/localStore'
import { markMentionAsRead } from './mentionService'
import { mentionNotificationId, selectRestorableMentions } from './mentionRestore'
import type { MentionRecord, WorkItemRecord } from '../../workspace/model/types'

export type NotificationItem = LiveNotificationPayload & {
  id: string
  is_read: boolean
}

const NOTIFICATIONS_STORAGE_KEY = 'grad-client-notifications'
const DISMISSED_MENTIONS_STORAGE_KEY = 'grad-client-dismissed-mentions'
const MAX_NOTIFICATIONS = 50
const MAX_DISMISSED_MENTIONS = 500

function getUserNotificationStorageKey(userId?: string) {
  return userId ? `${NOTIFICATIONS_STORAGE_KEY}:${userId}` : null
}

function getDismissedMentionStorageKey(userId?: string) {
  return userId ? `${DISMISSED_MENTIONS_STORAGE_KEY}:${userId}` : null
}

/** 벨에서 "전체 삭제"한 멘션은 다시 복원되지 않도록 기억한다. */
function loadDismissedMentionIds(userId?: string): Set<number> {
  const key = getDismissedMentionStorageKey(userId)
  if (typeof window === 'undefined' || !key) return new Set()

  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed.filter((id) => typeof id === 'number') : [])
  } catch {
    return new Set()
  }
}

function saveDismissedMentionIds(ids: number[], userId?: string) {
  const key = getDismissedMentionStorageKey(userId)
  if (typeof window === 'undefined' || !key) return

  try {
    window.localStorage.setItem(key, JSON.stringify(ids.slice(-MAX_DISMISSED_MENTIONS)))
  } catch (err) {
    console.error('Failed to save dismissed mentions:', err)
  }
}

export function loadStoredNotifications(userId?: string): NotificationItem[] {
  const key = getUserNotificationStorageKey(userId)
  if (typeof window === 'undefined' || !key) return []

  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return []
    return JSON.parse(raw) as NotificationItem[]
  } catch (err) {
    console.error('Failed to parse notifications from localStorage:', err)
    return []
  }
}

export function saveStoredNotifications(notifications: NotificationItem[], userId?: string) {
  const key = getUserNotificationStorageKey(userId)
  if (typeof window === 'undefined' || !key) return

  try {
    window.localStorage.setItem(key, JSON.stringify(notifications.slice(0, MAX_NOTIFICATIONS)))
  } catch (err) {
    console.error('Failed to save notifications to localStorage:', err)
  }
}

/** 멘션은 활동 로그와 ID 시퀀스가 달라 접두어를 붙인다(context/init 복원분과 같은 규칙). */
function createNotificationId(payload: LiveNotificationPayload) {
  if (payload.notification_id == null) {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
  }

  return payload.sub_type === 'MENTION'
    ? mentionNotificationId(payload.notification_id)
    : String(payload.notification_id)
}

/** 앱이 꺼져 있는 동안 발생한 알림 중 멘션만 복원한다(활동 알림은 피드·타임라인에서 확인). */
function loadUnreadMentionNotifications(userId?: string): NotificationItem[] {
  let mentions: MentionRecord[] = []

  try {
    mentions = readWorkspaceDb().mentions ?? []
  } catch {
    return []
  }

  return selectRestorableMentions(mentions, loadDismissedMentionIds(userId)).map((mention) => ({
    id: mentionNotificationId(mention.id),
    notification_id: mention.id,
    sub_type: 'MENTION',
    entity_type: 'COMMENT',
    entity_id: mention.workItemId,
    work_item_id: mention.workItemId,
    actor_name: mention.actorName,
    actor_user_id: mention.actorUserId,
    title: '멘션 알림',
    link_url: `/work-items/${mention.workItemId}`,
    is_read: false,
    created_at: mention.createdAt,
  }))
}

/** 서버 읽음 처리가 성공한 뒤에만 로컬 멘션 캐시를 맞춘다(실패 시 로컬 캐시를 건드리지 않는다). */
function syncLocalMentionAsRead(mentionId: number) {
  try {
    const db = readWorkspaceDb()
    const target = (db.mentions ?? []).find((mention) => mention.id === mentionId)
    if (!target || target.isRead) {
      return
    }

    target.isRead = true
    writeServerWorkspaceDb(db)
  } catch {
    // 캐시가 아직 없거나 저장에 실패하면 다음 context/init 에서 맞춰진다.
  }
}

export function useNotificationStore(userId?: string) {
  const [notifications, setNotifications] = useState<NotificationItem[]>(() =>
    loadStoredNotifications(userId),
  )

  useEffect(() => {
    setNotifications(loadStoredNotifications(userId))
  }, [userId])

  useEffect(() => {
    const unsubscribe = subscribeToLiveNotifications((payload) => {
      setNotifications((prev) => {
        const id = createNotificationId(payload)

        if (prev.some((n) => n.id === id)) {
          return prev
        }

        const newItem: NotificationItem = {
          ...payload,
          id,
          is_read: Boolean(payload.is_read),
        }

        const next = [newItem, ...prev].slice(0, MAX_NOTIFICATIONS)
        saveStoredNotifications(next, userId)
        return next
      })
    })

    return unsubscribe
  }, [userId])

  // context/init 이 내려준 미확인 멘션을 알림 목록에 합친다(없는 것만 추가).
  const mergeUnreadMentions = useCallback(() => {
    const unreadMentions = loadUnreadMentionNotifications(userId)
    if (unreadMentions.length === 0) {
      return
    }

    setNotifications((prev) => {
      const known = new Set(prev.map((item) => item.id))
      const additions = unreadMentions.filter((item) => !known.has(item.id))
      if (additions.length === 0) {
        return prev
      }

      const next = [...additions, ...prev].slice(0, MAX_NOTIFICATIONS)
      saveStoredNotifications(next, userId)
      return next
    })
  }, [userId])

  useEffect(() => {
    mergeUnreadMentions()
    return subscribeToWorkspaceCache(() => mergeUnreadMentions())
  }, [mergeUnreadMentions])

  const markAsRead = useCallback(
    (id: string) => {
      const target = notifications.find((item) => item.id === id)
      if (target?.sub_type === 'MENTION' && target.notification_id != null) {
        const mentionId = target.notification_id
        void markMentionAsRead(mentionId).then((succeeded) => {
          if (succeeded) {
            syncLocalMentionAsRead(mentionId)
          }
        })
      }

      setNotifications((prev) => {
        const next = prev.map((item) => (item.id === id ? { ...item, is_read: true } : item))
        saveStoredNotifications(next, userId)
        return next
      })
    },
    [notifications, userId],
  )

  const markAllAsRead = useCallback(() => {
    notifications.forEach((item) => {
      if (item.sub_type === 'MENTION' && !item.is_read && item.notification_id != null) {
        const mentionId = item.notification_id
        void markMentionAsRead(mentionId).then((succeeded) => {
          if (succeeded) {
            syncLocalMentionAsRead(mentionId)
          }
        })
      }
    })

    setNotifications((prev) => {
      const next = prev.map((item) => ({ ...item, is_read: true }))
      saveStoredNotifications(next, userId)
      return next
    })
  }, [notifications, userId])

  const clearNotifications = useCallback(() => {
    const dismissedMentionIds = notifications
      .filter((item) => item.sub_type === 'MENTION' && item.notification_id != null)
      .map((item) => item.notification_id as number)

    if (dismissedMentionIds.length > 0) {
      const merged = Array.from(new Set([...loadDismissedMentionIds(userId), ...dismissedMentionIds]))
      saveDismissedMentionIds(merged, userId)
    }

    setNotifications([])
    saveStoredNotifications([], userId)
  }, [notifications, userId])

  const unreadCount = notifications.filter((item) => !item.is_read).length

  let workItems: WorkItemRecord[] = []
  try { workItems = readWorkspaceDb().workItems } catch { /* The cache may not be initialized yet. */ }
  const resolvedActivities = useResolvedActivities(notifications.map((item, index) => ({
    id: item.notification_id ?? index,
    nodeId: item.node_id ?? 0,
    actorUserId: item.actor_user_id ?? '',
    actorName: item.actor_name ?? '',
    entityType: item.can_view_detail === false ? '' : item.entity_type ?? '',
    entityId: item.entity_id ?? '',
    targetName: item.target_name ?? '',
    actionType: item.action ?? '',
    createdAt: item.created_at,
  })), workItems)
  const resolvedNotifications = notifications.map((item, index) => {
    const activity = resolvedActivities[index]
    return activity.entityType === 'RECURRING_RULE' ? {
      ...item,
      entity_type: activity.entityType,
      title: '일정 알림',
      link_url: getActivityLink(activity) ?? item.link_url,
    } : item
  })

  return {
    notifications: resolvedNotifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    clearNotifications,
  }
}
