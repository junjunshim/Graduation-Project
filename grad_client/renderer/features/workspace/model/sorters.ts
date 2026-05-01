import type { OrganizationNodeRecord, WorkItemRecord } from './types'

export function compareWorkspaceDates(left?: string, right?: string) {
  return (left ?? '9999-12-31').localeCompare(right ?? '9999-12-31')
}

export function sortWorkspaceNodes(nodes: OrganizationNodeRecord[]) {
  return [...nodes].sort((left, right) => {
    return left.path.length - right.path.length || left.name.localeCompare(right.name, 'ko')
  })
}

export function sortWorkspaceWorkItems(workItems: WorkItemRecord[]) {
  return [...workItems].sort((left, right) => {
    return (
      compareWorkspaceDates(left.dueDate, right.dueDate) ||
      right.priority - left.priority ||
      left.title.localeCompare(right.title, 'ko')
    )
  })
}
