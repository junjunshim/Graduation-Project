import { apiRequest } from './server/apiClient.js'
import { isServerStatusResponse, parseServerContextItems, type ServerContextResponse } from './server/apiTypes.js'
import { loadServerWorkspace } from './server/serverWorkspace.js'
import { notifyRecurringCacheUpdated, notifyWorkspaceCacheRefreshFailed } from './workspaceCacheEvents.js'

export type MoveTransferTarget = { user_id: string; name: string; email: string }
export type NodeMovePreview = {
  node_id: number
  parent_node_id: number | null
  old_parent_node_id: number | null
  preview_token: string
  can_move: boolean
  nodes: Array<{ node_id: number; name: string; parent_node_id: number | null; path: number[]; new_path: number[]; is_deleted: boolean }>
  owner_groups: Array<MoveTransferTarget & {
    work_items: Array<{ work_item_id: string; title: string; owner_node_id: number; owner_node_name: string; hidden: boolean; status: string }>
    transfer_targets: MoveTransferTarget[]
  }>
  all_transfer_targets: MoveTransferTarget[]
  cleared_schedules: Array<{ rule_id: number; title: string; owner_node_id: number; assignee_user_id: string }>
  detached_work_item_ids: string[]
}

export async function fetchNodeMovePreview(nodeId: number, parentNodeId: number | null): Promise<NodeMovePreview> {
  const response = await apiRequest<unknown>('/org/nodes/move-preview', {
    method: 'POST', body: { node_id: nodeId, parent_node_id: parentNodeId },
  })
  if (!isServerStatusResponse(response)) throw new Error('이전 영향 응답 형식이 올바르지 않습니다.')
  if (response.status === 'error') throw new Error(response.message || '이전 영향을 확인하지 못했습니다.')
  const item = parseServerContextItems((response as ServerContextResponse).data)[0] as unknown as NodeMovePreview | undefined
  if (!item || !item.preview_token || !Array.isArray(item.nodes) || !Array.isArray(item.owner_groups)) {
    throw new Error('이전 영향 정보를 찾을 수 없습니다.')
  }
  return item
}

export async function moveNode(payload: {
  nodeId: number; parentNodeId: number | null; previewToken: string
  transfers?: Record<string, string>; newOwnerEmail?: string
}) {
  const response = await apiRequest<unknown>('/org/nodes/move', {
    method: 'PATCH',
    body: {
      node_id: payload.nodeId, parent_node_id: payload.parentNodeId, preview_token: payload.previewToken,
      ...(payload.newOwnerEmail ? { new_owner_email: payload.newOwnerEmail } : { transfers: payload.transfers ?? {} }),
    },
  })
  if (!isServerStatusResponse(response)) throw new Error('이전 결과를 확인하지 못했습니다. 목록을 새로고침해 주세요.')
  if (response.status === 'error') throw new Error(response.message || '워크스페이스를 이전하지 못했습니다.')
  notifyRecurringCacheUpdated()
  // Relocation affects inherited access across the subtree; replace the full
  // context so data whose access was lost does not survive in the local cache.
  try {
    await loadServerWorkspace()
  } catch {
    notifyWorkspaceCacheRefreshFailed('이전은 완료되었지만 최신 정보를 불러오지 못했습니다. 목록을 새로고침해 주세요.')
  }
}
