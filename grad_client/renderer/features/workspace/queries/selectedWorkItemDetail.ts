import type { SelectedWorkItemDetail, WorkItemRecord } from '../model/types'
import { getAccessibleNodeIdsForUser, getNodePathLabel, getOrgSnapshot } from '../data/orgService'

function compareByDate(left?: string, right?: string) {
  return (left ?? '9999-12-31').localeCompare(right ?? '9999-12-31')
}

function sortWorkItems(workItems: WorkItemRecord[]) {
  return [...workItems].sort((left, right) => {
    return (
      compareByDate(left.dueDate, right.dueDate) ||
      right.priority - left.priority ||
      left.title.localeCompare(right.title, 'ko')
    )
  })
}

export function getSelectedWorkItemDetail(workItemId: string, userId?: string): SelectedWorkItemDetail | null {
  const snapshot = getOrgSnapshot()
  const accessibleNodeIds = userId ? getAccessibleNodeIdsForUser(userId) : snapshot.nodes.map((node) => node.id)
  const visibleWorkItems = snapshot.workItems.filter((item) => accessibleNodeIds.includes(item.ownerNodeId))
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

  const childWorkItems = sortWorkItems(
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
