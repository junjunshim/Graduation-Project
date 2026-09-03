import { getAccessibleNodeIdsForUser } from '../data/orgService'
import { getNodeTypeLabel } from '../model/labels'
import { sortWorkspaceNodes } from '../model/sorters'
import type { IconName } from '../../../design-system/primitives/Icon'
import type { OrganizationNodeRecord, WorkspaceSnapshot } from '../model/types'
import type {
  WorkspaceDirectoryItem,
  WorkspaceDirectoryTone,
} from '../model/workspaceDirectory'

type OrganizationNode = OrganizationNodeRecord

type DirectoryVisualMetadata = Pick<WorkspaceDirectoryItem, 'iconName' | 'tone'>

export type WorkspaceDirectoryView = {
  hierarchyRoot: WorkspaceDirectoryItem | null
  rootOptions: WorkspaceDirectoryItem[]
  listItems: WorkspaceDirectoryItem[]
  defaultRootId: string | null
}

const ROOT_TONES: WorkspaceDirectoryTone[] = [
  'indigo',
  'teal',
  'blue',
  'green',
  'violet',
  'orange',
  'pink',
]

const NODE_VISUAL_METADATA: Record<string, DirectoryVisualMetadata> = {
  USER: { tone: 'violet', iconName: 'folder' },
  COMPANY: { tone: 'indigo', iconName: 'building' },
  DIVISION: { tone: 'blue', iconName: 'orgChart' },
  DEPARTMENT: { tone: 'teal', iconName: 'folder' },
  TEAM: { tone: 'green', iconName: 'users' },
  PROJECT: { tone: 'violet', iconName: 'cube' },
}

export function getNodeVisualMetadata(nodeType: string): DirectoryVisualMetadata {
  if (typeof nodeType === 'string' && nodeType.startsWith('CUSTOM:')) {
    const parts = nodeType.split(':')
    const customIcon = (parts[2] as IconName) || 'sparkles'
    return { tone: 'orange', iconName: customIcon }
  }

  return NODE_VISUAL_METADATA[nodeType] ?? { tone: 'orange', iconName: 'sparkles' }
}

function getCreatedDate(createdAt: string) {
  return createdAt.split('T', 1)[0] ?? createdAt
}

function getDescription(node: OrganizationNodeRecord, isRoot: boolean) {
  if (node.nodeType === 'USER') {
    return '개인 워크스페이스'
  }
  return isRoot ? '전체 조직 최상위 워크스페이스' : `${getNodeTypeLabel(node.nodeType)} 워크스페이스`
}

export function getWorkspaceDirectory(
  userId: string | undefined,
  snapshot: WorkspaceSnapshot,
): WorkspaceDirectoryView {
  if (!userId) {
    return {
      hierarchyRoot: null,
      rootOptions: [],
      listItems: [],
      defaultRootId: null,
    }
  }

  const accessibleNodeIds = new Set(getAccessibleNodeIdsForUser(userId, snapshot))
  const visibleNodes = sortWorkspaceNodes(
    snapshot.nodes.filter((node) => accessibleNodeIds.has(node.id)),
  )
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id))
  const childNodesByParentId = new Map<number, OrganizationNode[]>()
  const directMemberIdsByNodeId = new Map<number, Set<string>>()

  visibleNodes.forEach((node) => {
    if (node.parentNodeId === undefined || !visibleNodeIds.has(node.parentNodeId)) {
      return
    }

    const siblings = childNodesByParentId.get(node.parentNodeId) ?? []
    siblings.push(node)
    childNodesByParentId.set(node.parentNodeId, siblings)
  })

  // 노드별 직접 소속 역할 배정 맵
  const rolesByNodeId = new Map<number, Set<string>>()
  snapshot.roles.forEach((role) => {
    if (!visibleNodeIds.has(role.nodeId) || role.isDeleted) {
      return
    }

    const memberIds = rolesByNodeId.get(role.nodeId) ?? new Set<string>()
    memberIds.add(role.userId)
    rolesByNodeId.set(role.nodeId, memberIds)
  })

  // 각 노드별 직속 멤버: 해당 노드에 역할이 있으면서, 동시에 해당 노드의 하위 자식 노드들에 더 구체적인 역할로 배정(override)되지 않은 멤버
  visibleNodes.forEach((node) => {
    const assignedUserIds = rolesByNodeId.get(node.id) ?? new Set<string>()
    // 하위 자손 노드 ID 목록
    const descendantIds = new Set<number>()
    const queue = [...(childNodesByParentId.get(node.id) ?? [])]
    while (queue.length > 0) {
      const child = queue.shift()
      if (child && !descendantIds.has(child.id)) {
        descendantIds.add(child.id)
        queue.push(...(childNodesByParentId.get(child.id) ?? []))
      }
    }

    const descendantAssignedUsers = new Set<string>()
    descendantIds.forEach((descId) => {
      rolesByNodeId.get(descId)?.forEach((uid) => descendantAssignedUsers.add(uid))
    })

    const directUserIds = new Set<string>()
    assignedUserIds.forEach((uid) => {
      // 하위 노드에 구체적으로 배정되지 않은 경우에만 현재 노드의 직속 인원으로 판별
      if (!descendantAssignedUsers.has(uid)) {
        directUserIds.add(uid)
      }
    })

    // 만약 모든 멤버가 하위에 배정되어 0명이 되는 경우(예: 최상위 관리자도 하위에 배정된 경우 등), 최소한 해당 노드의 ADMIN/소유자는 직속으로 유지
    if (directUserIds.size === 0 && assignedUserIds.size > 0) {
      const adminRoles = snapshot.roles.filter((r) => r.nodeId === node.id && r.roleName === 'ADMIN' && !r.isDeleted)
      if (adminRoles.length > 0) {
        adminRoles.forEach((r) => directUserIds.add(r.userId))
      } else {
        // ADMIN이 없으면 첫 번째 배정자를 직속으로
        const firstUser = Array.from(assignedUserIds)[0]
        if (firstUser) directUserIds.add(firstUser)
      }
    }

    directMemberIdsByNodeId.set(node.id, directUserIds)
  })

  const rootNodes = sortWorkspaceNodes(
    visibleNodes.filter(
      (node) => node.parentNodeId === undefined || !visibleNodeIds.has(node.parentNodeId),
    ),
  )
  const itemsByNodeId = new Map<number, WorkspaceDirectoryItem>()

  function buildItem(
    node: OrganizationNode,
    rootId: string,
    rootTone: WorkspaceDirectoryTone,
    ancestors: ReadonlySet<number>,
  ): { item: WorkspaceDirectoryItem; memberIds: Set<string> } {
    const nextAncestors = new Set(ancestors)
    nextAncestors.add(node.id)

    const childResults = (childNodesByParentId.get(node.id) ?? [])
      .filter((child) => !nextAncestors.has(child.id))
      .map((child) => buildItem(child, rootId, rootTone, nextAncestors))
    const directMemberIds = directMemberIdsByNodeId.get(node.id) ?? new Set<string>()
    const memberIds = new Set(directMemberIds)

    childResults.forEach(({ memberIds: childMemberIds }) => {
      childMemberIds.forEach((memberId) => memberIds.add(memberId))
    })

    const isRoot = node.id.toString() === rootId
    const baseVisualMetadata = getNodeVisualMetadata(node.nodeType)
    const visualMetadata = isRoot
      ? { tone: rootTone, iconName: baseVisualMetadata.iconName }
      : baseVisualMetadata
    const item: WorkspaceDirectoryItem = {
      id: node.id.toString(),
      rootId,
      name: node.name,
      description: getDescription(node, isRoot),
      memberCount: memberIds.size,
      directMemberCount: directMemberIds.size,
      totalMemberCount: memberIds.size,
      childCount: childResults.length,
      createdAt: getCreatedDate(node.createdAt),
      isRoot,
      isFavorite: false,
      ...visualMetadata,
      children: childResults.map(({ item: childItem }) => childItem),
    }

    itemsByNodeId.set(node.id, item)
    return { item, memberIds }
  }

  const rootOptions = rootNodes.map((rootNode, rootIndex) =>
    buildItem(
      rootNode,
      rootNode.id.toString(),
      ROOT_TONES[rootIndex % ROOT_TONES.length] ?? 'indigo',
      new Set(),
    ).item,
  )
  const listItems = visibleNodes.flatMap((node) => {
    const item = itemsByNodeId.get(node.id)
    return item ? [item] : []
  })
  const hierarchyRoot = rootOptions[0] ?? null

  return {
    hierarchyRoot,
    rootOptions,
    listItems,
    defaultRootId: hierarchyRoot?.id ?? null,
  }
}
