import type { WorkspaceSnapshot } from '../model/types'
import { getEffectiveAuthorityBitSet } from '../model/effectiveAuthority.js'

/**
 * 업무 생성 권한(WI_PERSONAL_CHANGE, Bit 8 또는 WI_ASSIGN, Bit 10)이
 * 직속 또는 상위 경로(path)에서 상속되어 부여된 모든 노드 ID 집합 반환
 */
export function getServerCreatableNodeIds(userId: string, snapshot: WorkspaceSnapshot): Set<number> {
  const creatableNodeIds = new Set<number>()

  for (const node of snapshot.nodes) {
    if (node.isDeleted) continue
    const authBits = getEffectiveAuthorityBitSet(userId, node.id, snapshot)
    // Bit 8: WI_PERSONAL_CHANGE, Bit 10: WI_ASSIGN
    if (authBits.has(8) || authBits.has(10)) {
      creatableNodeIds.add(node.id)
    }
  }

  return creatableNodeIds
}

/**
 * 해당 조직에 업무 생성/변경/삭제 권한(WI_PERSONAL_CHANGE, Bit 8)이 있는 사용자 목록.
 * 만약 isHidden이 true인 경우 숨김 업무 변경 권한(WI_HIDDEN_CHANGE, Bit 9)까지 보유해야 함.
 */
export function getServerAssignableUsers(
  nodeId: number,
  snapshot: WorkspaceSnapshot,
  isHidden: boolean = false,
) {
  return snapshot.users.filter((user) => {
    if (!user.email) return false
    const authBits = getEffectiveAuthorityBitSet(user.userId, nodeId, snapshot)
    // 필수: WI_PERSONAL_CHANGE (Bit 8)
    const hasBaseChange = authBits.has(8)
    if (!hasBaseChange) return false

    // 숨김 업무인 경우: WI_HIDDEN_CHANGE (Bit 9) 필수
    if (isHidden && !authBits.has(9)) {
      return false
    }

    return true
  })
}

/**
 * 상위 업무 후보 목록:
 * 1. 선택된 담당 노드 + 직속 부모 노드(1단계 상위)의 업무로만 제한.
 * 2. 일반 업무(hidden=false) 및 숨김 업무(hidden=true) 포함.
 *    단, 숨김 업무는 현재 유저가 해당 노드에 대해 WI_HIDDEN_VIEW(Bit 6) 권한이 있을 때만 포함.
 */
export function getServerAvailableParentItems(
  userId: string,
  selectedNodeId: number,
  snapshot: WorkspaceSnapshot,
) {
  const selectedNode = snapshot.nodes.find((n) => n.id === selectedNodeId)
  if (!selectedNode) {
    return []
  }

  // 후보 노드 ID 목록: 현재 노드 + 직속 부모 노드(parentNodeId)
  const allowedNodeIds = new Set<number>([selectedNode.id])
  if (selectedNode.parentNodeId) {
    allowedNodeIds.add(selectedNode.parentNodeId)
  }

  return snapshot.workItems.filter((item) => {
    if (item.isDeleted) return false
    if (!allowedNodeIds.has(item.ownerNodeId)) return false

    // 숨김 업무인 경우, 현재 유저가 해당 노드에 대해 WI_HIDDEN_VIEW(Bit 6) 권한이 있는지 확인
    // 단, 담당자 본인 업무는 권한이 줄어도 후보에 남는다 (filePermission.ts 와 동일한 담당자 기준).
    if (item.hidden) {
      const ownerEmail = snapshot.users.find((user) => user.userId === userId)?.email?.toLowerCase()
      const isMine =
        item.ownerUserId === userId ||
        (Boolean(ownerEmail) && item.ownerUserId.toLowerCase() === ownerEmail)

      if (!isMine) {
        const authBits = getEffectiveAuthorityBitSet(userId, item.ownerNodeId, snapshot)
        if (!authBits.has(6)) {
          return false
        }
      }
    }

    return true
  })
}

/**
 * 선택된 조직(노드)에 이미 생성된 업무들에서 카테고리 목록을 동적으로 추출 (중복 제거)
 */
export function getNodeExistingCategories(
  nodeId: number,
  snapshot: WorkspaceSnapshot,
): string[] {
  const categorySet = new Set<string>()

  for (const item of snapshot.workItems) {
    if (item.isDeleted) continue
    if (item.ownerNodeId === nodeId && item.category && item.category.trim()) {
      categorySet.add(item.category.trim())
    }
  }

  return Array.from(categorySet).sort((a, b) => a.localeCompare(b, 'ko'))
}
