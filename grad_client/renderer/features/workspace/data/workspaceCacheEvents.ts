export const WORKSPACE_CACHE_UPDATED_EVENT = 'grad-client-workspace-cache-updated'
export const WORKSPACE_CACHE_REFRESH_FAILED_EVENT = 'grad-client-workspace-cache-refresh-failed'

export function notifyWorkspaceCacheUpdated() {
  if (typeof window === 'undefined') {
    return
  }

  window.dispatchEvent(new Event(WORKSPACE_CACHE_UPDATED_EVENT))
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
