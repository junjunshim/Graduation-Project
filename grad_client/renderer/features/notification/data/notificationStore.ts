import { useState, useEffect, useCallback } from 'react'
import {
  subscribeToLiveNotifications,
  type LiveNotificationPayload,
} from '../../workspace/data/workspaceCacheEvents'
import { useResolvedActivities } from '../../dashboard/model/useResolvedActivities'
import { getActivityLink } from '../../dashboard/model/activityLink'
import { readWorkspaceDb } from '../../workspace/data/localStore'
import type { WorkItemRecord } from '../../workspace/model/types'

export type NotificationItem = LiveNotificationPayload & {
  id: string
  is_read: boolean
}

const NOTIFICATIONS_STORAGE_KEY = 'grad-client-notifications'
const MAX_NOTIFICATIONS = 50

function getUserNotificationStorageKey(userId?: string) {
  return userId ? `${NOTIFICATIONS_STORAGE_KEY}:${userId}` : null
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
        const id =
          payload.notification_id != null
            ? String(payload.notification_id)
            : `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`

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

  const markAsRead = useCallback(
    (id: string) => {
      setNotifications((prev) => {
        const next = prev.map((item) => (item.id === id ? { ...item, is_read: true } : item))
        saveStoredNotifications(next, userId)
        return next
      })
    },
    [userId],
  )

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => {
      const next = prev.map((item) => ({ ...item, is_read: true }))
      saveStoredNotifications(next, userId)
      return next
    })
  }, [userId])

  const clearNotifications = useCallback(() => {
    setNotifications([])
    saveStoredNotifications([], userId)
  }, [userId])

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
