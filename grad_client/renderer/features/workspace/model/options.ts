import type { NodeType, RoleName, WorkItemStatus } from './types'

export const WORK_ITEM_STATUS_OPTIONS: WorkItemStatus[] = ['todo', 'in-progress', 'done']

export const ROLE_OPTIONS: RoleName[] = ['ADMIN', 'MANAGER', 'MEMBER']

export const ORG_NODE_TYPE_OPTIONS: Exclude<NodeType, 'USER'>[] = [
  'COMPANY',
  'DIVISION',
  'DEPARTMENT',
  'TEAM',
  'PROJECT',
]

export const SUB_NODE_TYPE_OPTIONS: Exclude<NodeType, 'USER'>[] = ['DIVISION', 'DEPARTMENT', 'TEAM', 'PROJECT']
