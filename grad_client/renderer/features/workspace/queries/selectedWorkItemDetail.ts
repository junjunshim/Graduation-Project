import type { SelectedWorkItemDetail, WorkspaceSnapshot } from '../model/types'
import { getAccessibleNodeIdsForUser, getNodePathLabel, getOrgSnapshot } from '../data/orgService.js'
import { sortWorkspaceWorkItems } from '../model/sorters.js'

const selectedWorkItemDetailCache = new WeakMap<
  WorkspaceSnapshot,
  Map<string, SelectedWorkItemDetail | null>
>()
const MAX_SELECTED_WORK_ITEM_DETAIL_ENTRIES = 64

function getSelectedWorkItemDetailCacheKey(workItemId: string, userId?: string) {
  return `${userId ?? ''}\u0000${workItemId}`
}

function calculateSelectedWorkItemDetail(
  workItemId: string,
  userId: string | undefined,
  snapshot: WorkspaceSnapshot,
): SelectedWorkItemDetail | null {
  const accessibleNodeIds = userId
    ? getAccessibleNodeIdsForUser(userId, snapshot)
    : snapshot.nodes.map((node) => node.id)
  const accessibleNodeIdSet = new Set(accessibleNodeIds)
  const visibleWorkItems = snapshot.workItems.filter((item) => accessibleNodeIdSet.has(item.ownerNodeId) && !item.isDeleted)
  const visibleWorkItemIds = new Set(visibleWorkItems.map((item) => item.workItemId))
  const item = visibleWorkItems.find((candidate) => candidate.workItemId === workItemId)

  if (!item) {
    return null
  }

  const ownerNode = snapshot.nodes.find((candidate) => candidate.id === item.ownerNodeId)
  const ownerUser = snapshot.users.find((candidate) => candidate.userId === item.ownerUserId)

  if (!ownerNode || !ownerUser) {
    return null
  }

  const parentWorkItem =
    item.parentWorkItemId && visibleWorkItemIds.has(item.parentWorkItemId)
      ? visibleWorkItems.find((candidate) => candidate.workItemId === item.parentWorkItemId) ?? null
      : null

  const childWorkItems = sortWorkspaceWorkItems(
    visibleWorkItems.filter((candidate) => candidate.parentWorkItemId === item.workItemId),
  )

  return {
    item,
    ownerNode,
    ownerUser,
    ownerNodePathLabel: getNodePathLabel(ownerNode.id, snapshot.nodes),
    parentWorkItem,
    childWorkItems,
  }
}

export function getSelectedWorkItemDetail(
  workItemId: string,
  userId?: string,
  providedSnapshot?: WorkspaceSnapshot,
): SelectedWorkItemDetail | null {
  const snapshot = providedSnapshot ?? getOrgSnapshot()
  const cacheKey = getSelectedWorkItemDetailCacheKey(workItemId, userId)
  let snapshotCache = selectedWorkItemDetailCache.get(snapshot)

  if (snapshotCache?.has(cacheKey)) {
    return snapshotCache.get(cacheKey) ?? null
  }

  const detail = calculateSelectedWorkItemDetail(workItemId, userId, snapshot)
  snapshotCache ??= new Map<string, SelectedWorkItemDetail | null>()

  if (snapshotCache.size >= MAX_SELECTED_WORK_ITEM_DETAIL_ENTRIES) {
    const oldestKey = snapshotCache.keys().next()
    if (!oldestKey.done) {
      snapshotCache.delete(oldestKey.value)
    }
  }

  snapshotCache.set(cacheKey, detail)
  selectedWorkItemDetailCache.set(snapshot, snapshotCache)
  return detail
}
