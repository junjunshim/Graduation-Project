import type { NodeType, WorkItemStatus } from './types'

export function getWorkItemStatusLabel(status: WorkItemStatus) {
  if (status === 'todo') {
    return '예정'
  }

  if (status === 'in-progress') {
    return '진행 중'
  }

  return '완료'
}

export function getWorkItemStatusTone(status: WorkItemStatus) {
  if (status === 'todo') {
    return 'todo' as const
  }

  if (status === 'in-progress') {
    return 'inProgress' as const
  }

  return 'done' as const
}

export function getNodeTypeLabel(nodeType: NodeType) {
  if (typeof nodeType === 'string' && nodeType.startsWith('CUSTOM:')) {
    const parts = nodeType.split(':')
    return parts[1] || '사용자 지정'
  }

  switch (nodeType) {
    case 'USER':
      return '개인공간'
    case 'COMPANY':
      return '회사'
    case 'DIVISION':
      return '본부'
    case 'DEPARTMENT':
      return '부서'
    case 'TEAM':
      return '팀'
    case 'PROJECT':
      return '프로젝트'
    default:
      return nodeType
  }
}
