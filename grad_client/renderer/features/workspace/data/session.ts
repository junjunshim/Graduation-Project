import type { WorkspaceDatabase } from '../model/types'

const SESSION_STORAGE_KEY = 'grad-client-mvp-session'

function hasStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

export function getCurrentSessionUserId() {
  if (!hasStorage()) {
    return null
  }

  return window.localStorage.getItem(SESSION_STORAGE_KEY)
}

export function setCurrentSessionUserId(userId: string | null) {
  if (!hasStorage()) {
    return
  }

  if (userId) {
    window.localStorage.setItem(SESSION_STORAGE_KEY, userId)
    return
  }

  window.localStorage.removeItem(SESSION_STORAGE_KEY)
}

export function ensureSessionUserExists(db: WorkspaceDatabase) {
  const sessionUserId = getCurrentSessionUserId()

  if (!sessionUserId) {
    return false
  }

  if (db.users.some((user) => user.userId === sessionUserId)) {
    return false
  }

  setCurrentSessionUserId(null)
  return true
}
