import { getAccessibleNodeIdsForUser } from '../data/orgService'
import { getWorkspaceMemberSummary } from '../model/memberInheritance'
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
  options?: { selectedRootId?: string | null },
): WorkspaceDirectoryView {
  return queryWorkspaceDirectory(snapshot, userId ? { userId } : null, options)
}

export function queryWorkspaceDirectory(
  snapshot: WorkspaceSnapshot,
  currentUser: { userId: string } | null,
  options?: { selectedRootId?: string | null },
): WorkspaceDirectoryView {
  const userId = currentUser?.userId?.trim()
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

  visibleNodes.forEach((node) => {
    if (node.parentNodeId === undefined || !visibleNodeIds.has(node.parentNodeId)) {
      return
    }

    const siblings = childNodesByParentId.get(node.parentNodeId) ?? []
    siblings.push(node)
    childNodesByParentId.set(node.parentNodeId, siblings)
  })

  // 모든 노드에 대해 단일 공통 함수(getWorkspaceMemberSummary)를 통해 팀원 지표를 사전 계산
  const memberSummaryByNodeId = new Map<number, ReturnType<typeof getWorkspaceMemberSummary>>()
  visibleNodes.forEach((node) => {
    const summary = getWorkspaceMemberSummary({
      rootNode: node,
      nodes: snapshot.nodes,
      roles: snapshot.roles,
      users: snapshot.users,
      authorities: snapshot.authorities,
    })
    memberSummaryByNodeId.set(node.id, summary)
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
  ): WorkspaceDirectoryItem {
    const nextAncestors = new Set(ancestors)
    nextAncestors.add(node.id)

    const childResults = (childNodesByParentId.get(node.id) ?? [])
      .filter((child) => !nextAncestors.has(child.id))
      .map((child) => buildItem(child, rootId, rootTone, nextAncestors))

    const memberSummary = memberSummaryByNodeId.get(node.id) ?? {
      totalCount: 0,
      directCount: 0,
      inheritedCount: 0,
      overriddenCount: 0,
      displayValue: '0',
      description: '직속 0',
    }

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
      memberCount: memberSummary.totalCount,
      directMemberCount: memberSummary.directCount,
      inheritedMemberCount: memberSummary.inheritedCount,
      totalMemberCount: memberSummary.totalCount,
      memberSummary,
      childCount: childResults.length,
      createdAt: getCreatedDate(node.createdAt),
      isRoot,
      isFavorite: false,
      ...visualMetadata,
      children: childResults,
    }

    itemsByNodeId.set(node.id, item)
    return item
  }

  const rootOptions = rootNodes.map((rootNode, rootIndex) =>
    buildItem(
      rootNode,
      rootNode.id.toString(),
      ROOT_TONES[rootIndex % ROOT_TONES.length] ?? 'indigo',
      new Set(),
    ),
  )
  const listItems = visibleNodes.flatMap((node) => {
    const item = itemsByNodeId.get(node.id)
    return item ? [item] : []
  })
  
  const selectedRootId = options?.selectedRootId
  const hierarchyRoot = 
    (selectedRootId ? rootOptions.find((o) => o.id === selectedRootId) : rootOptions[0]) ?? null

  return {
    hierarchyRoot,
    rootOptions,
    listItems,
    defaultRootId: hierarchyRoot?.id ?? null,
  }
}
