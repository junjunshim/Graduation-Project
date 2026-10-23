export const REMEMBERED_EMAIL_STORAGE_KEY = 'axis-remembered-login-email'

type StorageLike = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>

function getLocalStorage(): StorageLike | null {
  if (typeof window === 'undefined') {
    return null
  }

  return window.localStorage
}

export function readRememberedEmail(storage: StorageLike | null = getLocalStorage()): string {
  if (!storage) {
    return ''
  }

  try {
    return storage.getItem(REMEMBERED_EMAIL_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveRememberedEmail(
  email: string,
  remember: boolean,
  storage: StorageLike | null = getLocalStorage(),
) {
  if (!storage) {
    return
  }

  try {
    if (remember) {
      storage.setItem(REMEMBERED_EMAIL_STORAGE_KEY, email.trim())
    } else {
      storage.removeItem(REMEMBERED_EMAIL_STORAGE_KEY)
    }
  } catch {
    // Storage can be unavailable in restricted webviews; login must still continue.
  }
}
