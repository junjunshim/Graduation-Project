import type { IconName } from '../../../design-system/primitives/Icon'

export type WorkspaceDirectoryTone =
  | 'indigo'
  | 'teal'
  | 'blue'
  | 'green'
  | 'violet'
  | 'orange'
  | 'pink'

export type WorkspaceDirectoryItem = {
  id: string
  rootId: string
  name: string
  description: string
  memberCount: number
  directMemberCount: number
  totalMemberCount: number
  childCount: number
  createdAt: string
  isRoot: boolean
  isFavorite: boolean
  tone: WorkspaceDirectoryTone
  iconName: IconName
  children: WorkspaceDirectoryItem[]
}
