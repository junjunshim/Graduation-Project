const ACTIVE_WORKSPACE_ROOT_KEY = 'grad-client-active-workspace-root'
const DEFAULT_WORKSPACE_ROOT_KEY = 'grad-client-default-workspace-root'

function getUserStorageKey(baseKey: string, userId: string | undefined) {
  return userId ? `${baseKey}:${userId}` : null
}

export function getDefaultWorkspaceRootId(userId?: string) {
  const storageKey = getUserStorageKey(DEFAULT_WORKSPACE_ROOT_KEY, userId)

  if (typeof window === 'undefined' || !storageKey) {
    return null
  }

  return window.localStorage.getItem(storageKey)
}

export function getActiveWorkspaceRootId(userId?: string) {
  const storageKey = getUserStorageKey(ACTIVE_WORKSPACE_ROOT_KEY, userId)

  if (typeof window === 'undefined' || !storageKey) {
    return null
  }

  return window.sessionStorage.getItem(storageKey)
}

export function selectWorkspaceRoot(
  rootId: string,
  rememberSelection: boolean,
  userId?: string,
) {
  const activeStorageKey = getUserStorageKey(ACTIVE_WORKSPACE_ROOT_KEY, userId)
  const defaultStorageKey = getUserStorageKey(DEFAULT_WORKSPACE_ROOT_KEY, userId)

  if (typeof window === 'undefined' || !activeStorageKey || !defaultStorageKey) {
    return
  }

  window.sessionStorage.setItem(activeStorageKey, rootId)

  if (rememberSelection) {
    window.localStorage.setItem(defaultStorageKey, rootId)
  } else {
    window.localStorage.removeItem(defaultStorageKey)
  }
}
