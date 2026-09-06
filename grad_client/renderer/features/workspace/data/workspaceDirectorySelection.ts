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

const FAVORITE_WORKSPACES_KEY = 'grad-client-favorite-workspaces'

export function getFavoriteWorkspaceIds(userId?: string): Set<string> {
  const storageKey = getUserStorageKey(FAVORITE_WORKSPACES_KEY, userId)

  if (typeof window === 'undefined' || !storageKey) {
    return new Set()
  }

  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? new Set(parsed) : new Set()
  } catch {
    return new Set()
  }
}

export function toggleFavoriteWorkspaceId(id: string, userId?: string): Set<string> {
  const currentFavorites = getFavoriteWorkspaceIds(userId)
  const storageKey = getUserStorageKey(FAVORITE_WORKSPACES_KEY, userId)

  if (currentFavorites.has(id)) {
    currentFavorites.delete(id)
  } else {
    currentFavorites.add(id)
  }

  if (typeof window !== 'undefined' && storageKey) {
    window.localStorage.setItem(storageKey, JSON.stringify(Array.from(currentFavorites)))
  }

  return currentFavorites
}

export function pruneFavoriteWorkspaceIds(validIds: Set<string>, userId?: string): Set<string> {
  const currentFavorites = getFavoriteWorkspaceIds(userId)
  const storageKey = getUserStorageKey(FAVORITE_WORKSPACES_KEY, userId)

  let changed = false
  for (const id of currentFavorites) {
    if (!validIds.has(id)) {
      currentFavorites.delete(id)
      changed = true
    }
  }

  if (changed && typeof window !== 'undefined' && storageKey) {
    window.localStorage.setItem(storageKey, JSON.stringify(Array.from(currentFavorites)))
  }

  return currentFavorites
}

