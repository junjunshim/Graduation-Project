import type { LiveNotificationPayload } from '../../workspace/data/workspaceCacheEvents'

const TOAST_EVENT = 'grad-client-toast'

export function showToast(payload: LiveNotificationPayload) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: payload }))
}

export function subscribeToToasts(listener: (payload: LiveNotificationPayload) => void) {
  if (typeof window === 'undefined') return () => undefined
  const handleEvent = (event: Event) => {
    if (event instanceof CustomEvent) listener(event.detail as LiveNotificationPayload)
  }
  window.addEventListener(TOAST_EVENT, handleEvent)
  return () => window.removeEventListener(TOAST_EVENT, handleEvent)
}
