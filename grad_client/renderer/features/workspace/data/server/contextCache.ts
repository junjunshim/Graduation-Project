import type {
  ActivityRecord,
  AuthorityRecord,
  MentionRecord,
  WorkItemFileRecord,
} from '../../model/types'

const SERVER_CONTEXT_STORAGE_KEY = 'grad-client-server-context'

export type ServerContextSnapshot = {
  serverTime: string
  authorities: AuthorityRecord[]
  mentions: MentionRecord[]
  activities: ActivityRecord[]
  files: WorkItemFileRecord[]
}

function getStorage() {
  if (typeof window === 'undefined') {
    return null
  }

  try {
    return window.localStorage
  } catch {
    return null
  }
}

function isServerContextSnapshot(value: unknown): value is ServerContextSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const snapshot = value as Record<string, unknown>

  return (
    typeof snapshot.serverTime === 'string' &&
    Boolean(snapshot.serverTime.trim()) &&
    Array.isArray(snapshot.authorities) &&
    Array.isArray(snapshot.mentions) &&
    Array.isArray(snapshot.activities) &&
    Array.isArray(snapshot.files)
  )
}

export function getServerContextSnapshot(): ServerContextSnapshot | null {
  const storage = getStorage()

  if (!storage) {
    return null
  }

  try {
    const serialized = storage.getItem(SERVER_CONTEXT_STORAGE_KEY)

    if (!serialized) {
      return null
    }

    const snapshot: unknown = JSON.parse(serialized)
    return isServerContextSnapshot(snapshot) ? snapshot : null
  } catch {
    return null
  }
}

export function setServerContextSnapshot(snapshot: ServerContextSnapshot) {
  const storage = getStorage()

  if (!storage || !isServerContextSnapshot(snapshot)) {
    return false
  }

  try {
    storage.setItem(SERVER_CONTEXT_STORAGE_KEY, JSON.stringify(snapshot))
    return true
  } catch {
    return false
  }
}

export function clearServerContextSnapshot() {
  const storage = getStorage()

  if (!storage) {
    return
  }

  try {
    storage.removeItem(SERVER_CONTEXT_STORAGE_KEY)
  } catch {
    // Storage can be unavailable in hardened browser/Electron profiles.
  }
}
