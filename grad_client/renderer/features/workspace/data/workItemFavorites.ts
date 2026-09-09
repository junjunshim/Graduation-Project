export function getFavoriteWorkItemIds(userId?: string): string[] {
  if (!userId || typeof window === 'undefined') return []
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(`grad-client-favorite-work-items:${userId}`) ?? '[]')
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  } catch { return [] }
}

export function toggleFavoriteWorkItem(id: string, userId?: string) {
  if (!userId) return
  const current = getFavoriteWorkItemIds(userId)
  const next = current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
  window.localStorage.setItem(`grad-client-favorite-work-items:${userId}`, JSON.stringify(next))
  window.dispatchEvent(new Event('grad-client-favorites-updated'))
}
