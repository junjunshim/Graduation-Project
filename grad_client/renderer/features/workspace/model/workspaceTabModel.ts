import type { IconName } from '../../../design-system/primitives/Icon'
import {
  canChangeRoleDefinitions,
  canManageNodeRoles,
  canViewFiles,
  canViewGithub,
  canViewMembers,
  canViewSchedule,
  canViewWorkItems,
} from './effectiveAuthority'
import type { WorkspaceSnapshot } from './types'

export type WorkspaceView =
  | 'overview'
  | 'tasks'
  | 'timeline'
  | 'schedules'
  | 'files'
  | 'github'
  | 'members'
  | 'roles'

export type WorkspaceSubTabItem = {
  view: WorkspaceView
  label: string
  icon: IconName
  disabledReason?: string
}

export const WORKSPACE_SUB_TABS: Array<{ view: WorkspaceView; label: string; icon: IconName }> = [
  { view: 'overview', label: '개요', icon: 'building' },
  { view: 'tasks', label: '업무', icon: 'checkSquare' },
  { view: 'timeline', label: '타임라인', icon: 'clock' },
  { view: 'schedules', label: '일정', icon: 'calendar' },
  { view: 'files', label: '파일', icon: 'fileText' },
  { view: 'github', label: 'GitHub', icon: 'globe' },
  { view: 'members', label: '사용자', icon: 'users' },
  { view: 'roles', label: '역할/권한', icon: 'lock' },
]

export function getWorkspaceTabPermissions(
  userId: string | null | undefined,
  nodeId: number | null | undefined,
  snapshot: WorkspaceSnapshot,
): Record<WorkspaceView, boolean> {
  if (!userId || !nodeId) {
    return {
      overview: true,
      tasks: false,
      timeline: false,
      schedules: false,
      files: false,
      github: false,
      members: false,
      roles: false,
    }
  }

  const canViewWI = canViewWorkItems(userId, nodeId, snapshot)
  const canViewSched = canViewSchedule(userId, nodeId, snapshot)
  const canViewFil = canViewFiles(userId, nodeId, snapshot)
  const canViewGit = canViewGithub(userId, nodeId, snapshot)
  const canViewMem = canViewMembers(userId, nodeId, snapshot)
  const canManageRoles =
    canManageNodeRoles(userId, nodeId, snapshot) ||
    canChangeRoleDefinitions(userId, nodeId, snapshot)

  return {
    overview: true,
    tasks: canViewWI,
    timeline: canViewWI,
    schedules: canViewSched,
    files: canViewFil,
    github: canViewGit,
    members: canViewMem,
    roles: canManageRoles,
  }
}
