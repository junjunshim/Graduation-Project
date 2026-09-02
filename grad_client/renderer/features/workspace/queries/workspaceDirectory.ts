import { getAccessibleNodeIdsForUser } from '../data/orgService'
import { getNodeTypeLabel } from '../model/labels'
import { sortWorkspaceNodes } from '../model/sorters'
import type { NodeType, OrganizationNodeRecord, WorkspaceSnapshot } from '../model/types'
import type {
  WorkspaceDirectoryItem,
  WorkspaceDirectoryTone,
} from '../model/workspaceDirectory'

type OrganizationNodeType = NodeType
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

const NODE_VISUAL_METADATA: Record<OrganizationNodeType, DirectoryVisualMetadata> = {
  USER: { tone: 'violet', iconName: 'folder' },
  COMPANY: { tone: 'indigo', iconName: 'building' },
  DIVISION: { tone: 'blue', iconName: 'orgChart' },
  DEPARTMENT: { tone: 'teal', iconName: 'folder' },
  TEAM: { tone: 'green', iconName: 'users' },
  PROJECT: { tone: 'violet', iconName: 'cube' },
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

  snapshot.roles.forEach((role) => {
    if (!visibleNodeIds.has(role.nodeId)) {
      return
    }

    const memberIds = directMemberIdsByNodeId.get(role.nodeId) ?? new Set<string>()
    memberIds.add(role.userId)
    directMemberIdsByNodeId.set(role.nodeId, memberIds)
  })

  childNodesByParentId.forEach((children, parentNodeId) => {
    childNodesByParentId.set(parentNodeId, sortWorkspaceNodes(children))
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
    const memberIds = new Set(directMemberIdsByNodeId.get(node.id) ?? [])

    childResults.forEach(({ memberIds: childMemberIds }) => {
      childMemberIds.forEach((memberId) => memberIds.add(memberId))
    })

    const isRoot = node.id.toString() === rootId
    const visualMetadata = isRoot
      ? { tone: rootTone, iconName: 'building' as const }
      : NODE_VISUAL_METADATA[node.nodeType]
    const item: WorkspaceDirectoryItem = {
      id: node.id.toString(),
      rootId,
      name: node.name,
      description: getDescription(node, isRoot),
      memberCount: memberIds.size,
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
