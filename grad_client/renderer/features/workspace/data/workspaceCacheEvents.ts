export const WORKSPACE_CACHE_UPDATED_EVENT = 'grad-client-workspace-cache-updated'
export const WORKSPACE_CACHE_REFRESH_FAILED_EVENT = 'grad-client-workspace-cache-refresh-failed'
export const RECURRING_CACHE_UPDATED_EVENT = 'grad-client-recurring-cache-updated'

export function notifyWorkspaceCacheUpdated() {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new Event(WORKSPACE_CACHE_UPDATED_EVENT))
}

export function notifyRecurringCacheUpdated(nodeId?: number) {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new CustomEvent(RECURRING_CACHE_UPDATED_EVENT, { detail: { nodeId } }))
}

export function subscribeToRecurringCache(listener: (event: { nodeId?: number }) => void) {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  const handle = (e: Event) => {
    if (e instanceof CustomEvent) {
      listener(e.detail || {})
    } else {
      listener({})
    }
  }

  window.addEventListener(RECURRING_CACHE_UPDATED_EVENT, handle)
  return () => window.removeEventListener(RECURRING_CACHE_UPDATED_EVENT, handle)
}

export function subscribeToWorkspaceCache(listener: () => void) {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  window.addEventListener(WORKSPACE_CACHE_UPDATED_EVENT, listener)
  return () => window.removeEventListener(WORKSPACE_CACHE_UPDATED_EVENT, listener)
}

export function notifyWorkspaceCacheRefreshFailed(message: string) {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(
    new CustomEvent<string>(WORKSPACE_CACHE_REFRESH_FAILED_EVENT, { detail: message }),
  )
}

export function subscribeToWorkspaceCacheRefreshFailure(listener: (message: string) => void) {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  const handleFailure = (event: Event) => {
    const message =
      event instanceof CustomEvent && typeof event.detail === 'string'
        ? event.detail
        : '최신 서버 데이터를 다시 불러오지 못했습니다.'
    listener(message)
  }

  window.addEventListener(WORKSPACE_CACHE_REFRESH_FAILED_EVENT, handleFailure)
  return () => window.removeEventListener(WORKSPACE_CACHE_REFRESH_FAILED_EVENT, handleFailure)
}

export const LIVE_NOTIFICATION_EVENT = 'grad-client-live-notification'

export type LiveNotificationPayload = {
  notification_id?: number
  node_id?: number
  entity_type?: string
  entity_id?: string
  work_item_id?: string
  sub_type?: string
  is_recurring_file?: boolean
  action?: string
  actor_user_id?: string
  actor_name?: string
  target_name?: string
  field_name?: string | null
  old_value?: string | null
  new_value?: string | null
  title?: string
  content?: string
  link_url?: string
  is_read?: boolean
  created_at: string
  can_view_detail?: boolean
}

export function notifyLiveNotificationReceived(payload: LiveNotificationPayload) {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(
    new CustomEvent<LiveNotificationPayload>(LIVE_NOTIFICATION_EVENT, { detail: payload }),
  )
}

export function subscribeToLiveNotifications(listener: (notification: LiveNotificationPayload) => void) {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  const handleNotification = (event: Event) => {
    if (event instanceof CustomEvent && event.detail) {
      listener(event.detail as LiveNotificationPayload)
    }
  }

  window.addEventListener(LIVE_NOTIFICATION_EVENT, handleNotification)
  return () => window.removeEventListener(LIVE_NOTIFICATION_EVENT, handleNotification)
}

