import type {
  OrganizationNodeRecord,
  WorkItemComposerContext,
  WorkItemRecord,
} from '../model/types'
import { getAccessibleNodeIdsForUser, getNodePathLabel, getOrgSnapshot } from '../data/orgService'
import { getNextGeneratedWorkItemId } from '../data/workItemService'
import { getCurrentUser } from '../data/userService'

function compareByDate(left?: string, right?: string) {
  return (left ?? '9999-12-31').localeCompare(right ?? '9999-12-31')
}

function sortNodes(nodes: OrganizationNodeRecord[]) {
  return [...nodes].sort((left, right) => {
    return left.path.length - right.path.length || left.name.localeCompare(right.name, 'ko')
  })
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

export function getWorkItemComposerContext(userId = getCurrentUser()?.userId, nodeId?: number): WorkItemComposerContext {
  const currentUser = getCurrentUser()
  const snapshot = getOrgSnapshot()
  const accessibleNodeIds = userId ? getAccessibleNodeIdsForUser(userId) : snapshot.nodes.map((node) => node.id)
  const availableNodes = sortNodes(snapshot.nodes.filter((node) => accessibleNodeIds.includes(node.id)))

  const selectedNode =
    availableNodes.find((node) => node.id === nodeId) ??
    availableNodes.find((node) => node.id === currentUser?.personalNodeId) ??
    availableNodes.find((node) => node.nodeType !== 'USER') ??
    availableNodes[0] ??
    null

  const assignableUsers = selectedNode
    ? (() => {
        const userIds = Array.from(
          new Set(
            snapshot.roles
              .filter((role) => selectedNode.path.includes(role.nodeId))
              .map((role) => role.userId),
          ),
        )

        const users = snapshot.users.filter((user) => userIds.includes(user.userId))

        if (users.length > 0) {
          return users
        }

        return currentUser ? [currentUser] : snapshot.users
      })()
    : currentUser
      ? [currentUser]
      : snapshot.users

  const availableParentItems = selectedNode
    ? sortWorkItems(snapshot.workItems.filter((item) => selectedNode.path.includes(item.ownerNodeId)))
    : []

  return {
    suggestedWorkItemId: getNextGeneratedWorkItemId(),
    availableNodes,
    selectedNode,
    pathLabel: selectedNode ? getNodePathLabel(selectedNode.id, snapshot.nodes) : '경로 없음',
    assignableUsers,
    availableParentItems,
  }
}
