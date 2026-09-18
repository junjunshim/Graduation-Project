const SESSION_STORAGE_KEY = 'grad-client-server-session-user'

function hasStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

/** 서버 세션에서 로그인한 사용자 식별자(이메일) */
export function getCurrentSessionUserId() {
  if (!hasStorage()) {
    return null
  }

  try {
    return window.localStorage.getItem(SESSION_STORAGE_KEY)
  } catch {
    return null
  }
}

export function setCurrentSessionUserId(userId: string | null) {
  if (!hasStorage()) {
    return
  }

  try {
    if (userId) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, userId)
      return
    }

    window.localStorage.removeItem(SESSION_STORAGE_KEY)
  } catch {
    // Storage can be unavailable in hardened browser/Electron profiles.
  }
}
