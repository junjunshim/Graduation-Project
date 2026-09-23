import type { IconName } from '../../../design-system/primitives/Icon'
import type { WorkspaceMemberSummary } from '../model/memberInheritance'

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
  inheritedMemberCount: number
  totalMemberCount: number
  memberSummary: WorkspaceMemberSummary
  childCount: number
  createdAt: string
  isRoot: boolean
  isFavorite: boolean
  tone: WorkspaceDirectoryTone
  iconName: IconName
  children: WorkspaceDirectoryItem[]
  canEnter?: boolean
  /** 휴지통으로 이동한(삭제된) 워크스페이스인지. 진입 화면에서 흐릿하게 표시하고 복구 대상으로 쓴다. */
  isDeleted?: boolean
}
