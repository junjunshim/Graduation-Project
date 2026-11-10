const FAVORITES_EVENT = 'grad-client-favorites-updated'

function storageKey(userId: string): string {
  return `grad-client-favorite-channels:${userId}`
}

export function getFavoriteChannelIds(userId?: string): string[] {
  if (!userId || typeof window === 'undefined') return []
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(storageKey(userId)) ?? '[]')
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function toggleFavoriteChannel(id: string, userId?: string): string[] {
  if (!userId) return []
  const current = getFavoriteChannelIds(userId)
  const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
  window.localStorage.setItem(storageKey(userId), JSON.stringify(next))
  window.dispatchEvent(new Event(FAVORITES_EVENT))
  return next
}
