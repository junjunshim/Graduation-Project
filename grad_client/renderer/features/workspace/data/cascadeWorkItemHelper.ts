import type { WorkItemFileRecord, WorkItemRecord } from '../model/types'

export type CascadeWorkItemSummary = {
  rootWorkItem: WorkItemRecord
  descendantWorkItems: WorkItemRecord[]
  allWorkItems: WorkItemRecord[]
  allFiles: Array<{ id: number; name: string; size?: number; workItemId: string; workItemTitle: string }>
}

/**
 * 주어진 부모 업무(rootWorkItemId)를 기준으로 모든 하위 자손 업무와
 * 그 모든 업무들에 포함된 첨부파일을 재귀적으로 수집합니다.
 */
export function getCascadeWorkItemSummary(
  rootWorkItemId: string,
  allWorkItems: WorkItemRecord[],
  allFiles: WorkItemFileRecord[] = [],
  includeDeleted = false,
): CascadeWorkItemSummary | null {
  const root = allWorkItems.find((w) => w.workItemId === rootWorkItemId)
  if (!root) return null

  // 1. 모든 자손 업무 재귀 수집
  const descendantWorkItems: WorkItemRecord[] = []
  const queue: string[] = [rootWorkItemId]

  while (queue.length > 0) {
    const parentId = queue.shift()!
    const children = allWorkItems.filter((w) => {
      if (w.parentWorkItemId !== parentId) return false
      return includeDeleted ? true : !w.isDeleted
    })

    for (const child of children) {
      descendantWorkItems.push(child)
      queue.push(child.workItemId)
    }
  }

  const collectedWorkItems = [root, ...descendantWorkItems]
  const workItemIdSet = new Set(collectedWorkItems.map((w) => w.workItemId))
  const workItemTitleMap = new Map(collectedWorkItems.map((w) => [w.workItemId, w.title]))

  // 2. 수집된 모든 업무들의 첨부파일 수집
  const attachedFiles = allFiles
    .filter((f) => {
      if (!workItemIdSet.has(f.workItemId)) return false
      return includeDeleted ? true : !f.isDeleted
    })
    .map((f) => ({
      id: f.id,
      name: f.originalFileName,
      size: f.fileSize,
      workItemId: f.workItemId,
      workItemTitle: workItemTitleMap.get(f.workItemId) || f.workItemId,
    }))

  return {
    rootWorkItem: root,
    descendantWorkItems,
    allWorkItems: collectedWorkItems,
    allFiles: attachedFiles,
  }
}
