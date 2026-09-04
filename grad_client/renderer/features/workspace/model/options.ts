import type { RoleName, StandardNodeType, WorkItemStatus } from './types'

export const WORK_ITEM_STATUS_OPTIONS: WorkItemStatus[] = ['todo', 'in-progress', 'done']

export const ROLE_OPTIONS: RoleName[] = ['ADMIN', 'MANAGER', 'MEMBER', 'VIEWER']

export const ORG_NODE_TYPE_OPTIONS: Exclude<StandardNodeType, 'USER'>[] = [
  'COMPANY',
  'DIVISION',
  'DEPARTMENT',
  'TEAM',
  'PROJECT',
]

export const SUB_NODE_TYPE_OPTIONS: Exclude<StandardNodeType, 'USER'>[] = ['DIVISION', 'DEPARTMENT', 'TEAM', 'PROJECT']
