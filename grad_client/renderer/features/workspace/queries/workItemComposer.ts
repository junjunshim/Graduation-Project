import type { WorkItemComposerContext, WorkspaceSnapshot } from '../model/types'
import { getAccessibleNodeIdsForUser, getNodePathLabel, getOrgSnapshot } from '../data/orgService'
import { getNextGeneratedWorkItemId } from '../data/workItemService'
import { getCurrentUser } from '../data/userService'
import { sortWorkspaceNodes, sortWorkspaceWorkItems } from '../model/sorters'
import {
  getServerAssignableUsers,
  getServerAvailableParentItems,
  getServerCreatableNodeIds,
} from './serverWorkItemCreateContract'

type WorkItemComposerOptions = {
  enforceServerCreateContract?: boolean
}

export function getWorkItemComposerContext(
  userId?: string,
  nodeId?: number,
  providedSnapshot?: WorkspaceSnapshot,
  options: WorkItemComposerOptions = {},
): WorkItemComposerContext {
  const snapshot = providedSnapshot ?? getOrgSnapshot()
  const currentUser = getCurrentUser(snapshot)
  const resolvedUserId = userId ?? currentUser?.userId
  const accessibleNodeIds = options.enforceServerCreateContract && resolvedUserId
    ? Array.from(getServerCreatableNodeIds(resolvedUserId, snapshot))
    : resolvedUserId
      ? getAccessibleNodeIdsForUser(resolvedUserId, snapshot)
      : snapshot.nodes.map((node) => node.id)
  const accessibleNodeIdSet = new Set(accessibleNodeIds)
  const availableNodes = sortWorkspaceNodes(snapshot.nodes.filter((node) => accessibleNodeIdSet.has(node.id)))

  const selectedNode =
    availableNodes.find((node) => node.id === nodeId) ??
    availableNodes.find((node) => node.nodeType !== 'USER') ??
    availableNodes.find((node) => node.id === currentUser?.personalNodeId) ??
    availableNodes[0] ??
    null

  const assignableUsers = selectedNode
    ? options.enforceServerCreateContract
      ? getServerAssignableUsers(selectedNode.id, snapshot)
      : (() => {
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
    ? sortWorkspaceWorkItems(
        options.enforceServerCreateContract && resolvedUserId
          ? getServerAvailableParentItems(resolvedUserId, selectedNode.path, snapshot)
          : snapshot.workItems.filter((item) => selectedNode.path.includes(item.ownerNodeId)),
      )
    : []

  return {
    suggestedWorkItemId: getNextGeneratedWorkItemId(snapshot),
    availableNodes,
    selectedNode,
    pathLabel: selectedNode ? getNodePathLabel(selectedNode.id, snapshot.nodes) : '경로 없음',
    assignableUsers,
    availableParentItems,
  }
}
