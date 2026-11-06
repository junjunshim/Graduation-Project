export function getWorkItemListHref(nodeId?: string | number | null) {
  if (nodeId === undefined || nodeId === null || nodeId === '') {
    return '/work-items'
  }

  const normalizedNodeId = String(nodeId)
  const numericNodeId = Number(normalizedNodeId)

  if (!/^\d+$/.test(normalizedNodeId) || !Number.isSafeInteger(numericNodeId) || numericNodeId <= 0) {
    return '/work-items'
  }

  return `/workspace?view=tasks&nodeId=${encodeURIComponent(normalizedNodeId)}`
}
