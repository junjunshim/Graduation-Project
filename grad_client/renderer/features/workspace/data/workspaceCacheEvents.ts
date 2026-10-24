export const WORKSPACE_CACHE_UPDATED_EVENT = 'grad-client-workspace-cache-updated'
export const WORKSPACE_CACHE_REFRESH_FAILED_EVENT = 'grad-client-workspace-cache-refresh-failed'
export const RECURRING_CACHE_UPDATED_EVENT = 'grad-client-recurring-cache-updated'
export const GITHUB_CACHE_UPDATED_EVENT = 'grad-client-github-cache-updated'

export function notifyGithubCacheUpdated(nodeId?: number) {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new CustomEvent(GITHUB_CACHE_UPDATED_EVENT, { detail: { nodeId } }))
}

export function subscribeToGithubCache(listener: (event: { nodeId?: number }) => void) {
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

  window.addEventListener(GITHUB_CACHE_UPDATED_EVENT, handle)
  return () => window.removeEventListener(GITHUB_CACHE_UPDATED_EVENT, handle)
}

let isWorkspaceCacheNotificationQueued = false

export function notifyWorkspaceCacheUpdated() {
  if (typeof window === 'undefined') {
    return
  }

  // 한 tick 안에서 여러 번 저장해도 구독자(스냅샷/overview 계산)는 한 번만 깨어나게 한다.
  // 저장 자체는 writeServerWorkspaceDb 에서 즉시 끝나므로 데이터 최신성에는 영향이 없다.
  if (isWorkspaceCacheNotificationQueued) {
    return
  }

  isWorkspaceCacheNotificationQueued = true
  const flush = () => {
    isWorkspaceCacheNotificationQueued = false
    // 테스트/언마운트 중 window 가 사라졌다면 알림만 건너뛴다. 저장된 데이터 자체는 이미 최신이다.
    if (typeof window === 'undefined') {
      return
    }
    window.dispatchEvent(new Event(WORKSPACE_CACHE_UPDATED_EVENT))
  }

  if (typeof queueMicrotask === 'function') {
    queueMicrotask(flush)
  } else {
    Promise.resolve().then(flush)
  }
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
  notification_key?: string
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
  channel_id?: number
  channel_type?: string
  channel_name?: string | null
  parent_message_id?: number | null
  attachment_count?: number
  attachment_names?: string[]
  repo_id?: number
  repo_full_name?: string
  branch?: string
  commit_sha?: string
  commit_message?: string
  pushed_commit_count?: number
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

export const CHAT_REALTIME_EVENT = 'grad-client-chat-realtime-event'

export type ChatRealtimeEventPayload = {
  subType: string
  data: Record<string, unknown>
}

export function notifyChatRealtimeEvent(payload: ChatRealtimeEventPayload) {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(
    new CustomEvent<ChatRealtimeEventPayload>(CHAT_REALTIME_EVENT, { detail: payload }),
  )
}

export function subscribeToChatRealtimeEvents(
  listener: (payload: ChatRealtimeEventPayload) => void,
) {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  const handleChatEvent = (event: Event) => {
    if (event instanceof CustomEvent && event.detail) {
      listener(event.detail as ChatRealtimeEventPayload)
    }
  }

  window.addEventListener(CHAT_REALTIME_EVENT, handleChatEvent)
  return () => window.removeEventListener(CHAT_REALTIME_EVENT, handleChatEvent)
}

export const WORKSPACE_LIVE_REFRESH_EVENT = 'grad-client-workspace-live-refresh'

// 활동 상세 열람 권한이 없는 사용자에게도 워크스페이스 변경을 즉시 반영하기 위한 갱신 신호.
// 활동 내용은 담지 않고, 어떤 노드가 어떤 종류로 바뀌었는지만 전달한다.
export type WorkspaceLiveRefreshPayload = {
  nodeId: number | null
  entityType: string
  entityId: string
  action: string
  isRecurringFile: boolean
}

export function notifyWorkspaceLiveRefresh(payload: WorkspaceLiveRefreshPayload) {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(
    new CustomEvent<WorkspaceLiveRefreshPayload>(WORKSPACE_LIVE_REFRESH_EVENT, { detail: payload }),
  )
}

export function subscribeToWorkspaceLiveRefresh(
  listener: (payload: WorkspaceLiveRefreshPayload) => void,
) {
  if (typeof window === 'undefined') {
    return () => undefined
  }

  const handleRefresh = (event: Event) => {
    if (event instanceof CustomEvent && event.detail) {
      listener(event.detail as WorkspaceLiveRefreshPayload)
    }
  }

  window.addEventListener(WORKSPACE_LIVE_REFRESH_EVENT, handleRefresh)
  return () => window.removeEventListener(WORKSPACE_LIVE_REFRESH_EVENT, handleRefresh)
}
