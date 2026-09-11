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

  // 디렉터리 뷰 성능 최적화 (O(N)):
  // 500개 이상의 노드 전체에 대해 매번 O(N^2) 상속 분석 및 문자열 정렬을 수행하면 메인 스레드 렉이 발생하므로,
  // 디렉터리 카드에 필요한 직속 멤버 수를 1회 순회(Map 인덱싱)로 즉시 계산
  const directMemberCountByNodeId = new Map<number, number>()
  snapshot.roles.forEach((r) => {
    if (!r.isDeleted) {
      directMemberCountByNodeId.set(r.nodeId, (directMemberCountByNodeId.get(r.nodeId) ?? 0) + 1)
    }
  })

  // 사용자가 직접 할당받았거나 상속받은(자식 노드로 내려가는) 노드 ID 집합 계산
  // (상위 조상 노드는 식별용(NODE_PARENT_VIEW)으로만 보이며 역방향 상속이 없으므로 진입 불가)
  const userRoles = snapshot.roles.filter(
    (r) => !r.isDeleted && (r.userId === userId || r.userId.toLowerCase() === userId.toLowerCase()),
  )
  const directlyAssignedNodeIds = new Set(userRoles.map((r) => r.nodeId))
  const enterableNodeIds = new Set<number>()

  visibleNodes.forEach((node) => {
    // 1) 직접 역할이 할당된 노드
    if (directlyAssignedNodeIds.has(node.id)) {
      enterableNodeIds.add(node.id)
      return
    }
    // 2) path 상에 상위 노드 중 직접 역할이 있는 노드가 존재하는 경우 (상위 -> 하위 순방향 상속)
    if (node.path && Array.isArray(node.path)) {
      const hasInheritedRole = node.path.some(
        (ancestorId) => ancestorId !== node.id && directlyAssignedNodeIds.has(ancestorId),
      )
      if (hasInheritedRole) {
        enterableNodeIds.add(node.id)
      }
    }
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

    const directCount = directMemberCountByNodeId.get(node.id) ?? 0
    const memberSummary = {
      totalCount: directCount,
      directCount,
      inheritedCount: 0,
      overriddenCount: 0,
      displayValue: String(directCount),
      description: `직속 ${directCount}`,
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
      canEnter: enterableNodeIds.has(node.id),
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
