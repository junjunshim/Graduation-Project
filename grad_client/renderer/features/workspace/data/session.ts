import type { WorkspaceDatabase } from '../model/types'
import { getWorkspaceDataSource } from './workspaceMode.js'

const LEGACY_SESSION_STORAGE_KEY = 'grad-client-mvp-session'
const MOCK_SESSION_STORAGE_KEY = 'grad-client-mock-session'
const SERVER_SESSION_STORAGE_KEY = 'grad-client-server-session-user'

function hasStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

export function getCurrentSessionUserId() {
  if (!hasStorage()) {
    return null
  }

  const dataSource = getWorkspaceDataSource()
  const storageKey = dataSource === 'server' ? SERVER_SESSION_STORAGE_KEY : MOCK_SESSION_STORAGE_KEY

  try {
    const currentValue = window.localStorage.getItem(storageKey)

    if (currentValue) {
      return currentValue
    }

    const legacyValue = window.localStorage.getItem(LEGACY_SESSION_STORAGE_KEY)
    const canMigrateLegacyValue = Boolean(
      legacyValue && (dataSource === 'server' ? legacyValue.includes('@') : !legacyValue.includes('@')),
    )

    if (!legacyValue || !canMigrateLegacyValue) {
      return null
    }

    window.localStorage.setItem(storageKey, legacyValue)
    window.localStorage.removeItem(LEGACY_SESSION_STORAGE_KEY)
    return legacyValue
  } catch {
    return null
  }
}

export function setCurrentSessionUserId(userId: string | null) {
  if (!hasStorage()) {
    return
  }

  const storageKey =
    getWorkspaceDataSource() === 'server' ? SERVER_SESSION_STORAGE_KEY : MOCK_SESSION_STORAGE_KEY

  try {
    window.localStorage.removeItem(LEGACY_SESSION_STORAGE_KEY)

    if (userId) {
      window.localStorage.setItem(storageKey, userId)
      return
    }

    window.localStorage.removeItem(storageKey)
  } catch {
    // Storage can be unavailable in hardened browser/Electron profiles.
  }
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
