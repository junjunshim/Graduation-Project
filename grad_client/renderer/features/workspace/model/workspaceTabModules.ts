import type { WorkspaceView } from './workspaceTabModel'

export const loadWorkspaceOverviewTab = () => import('../components/WorkspaceOverviewTab')
export const loadWorkspaceTimelineTab = () => import('../components/WorkspaceTimelineTab')
export const loadWorkspaceTasksTab = () => import('../components/WorkspaceTasksTab')
export const loadWorkspaceSchedulesTab = () => import('../components/WorkspaceSchedulesTab')
export const loadWorkspaceFilesTab = () => import('../components/WorkspaceFilesTab')
export const loadWorkspaceGithubTab = () => import('../components/WorkspaceGithubTab')
export const loadWorkspaceMembersTab = () => import('../components/WorkspaceMembersTab')
export const loadWorkspaceRolesTab = () => import('../components/WorkspaceRolesTab')

const prefetchers: Record<WorkspaceView, () => Promise<unknown>> = {
  overview: loadWorkspaceOverviewTab,
  timeline: loadWorkspaceTimelineTab,
  tasks: loadWorkspaceTasksTab,
  schedules: loadWorkspaceSchedulesTab,
  files: loadWorkspaceFilesTab,
  github: loadWorkspaceGithubTab,
  members: loadWorkspaceMembersTab,
  roles: loadWorkspaceRolesTab,
}

const prefetchedViews = new Set<WorkspaceView>()

export function prefetchWorkspaceTab(view: WorkspaceView) {
  if (prefetchedViews.has(view)) {
    return
  }

  prefetchedViews.add(view)
  void prefetchers[view]().catch(() => {
    // Prefetch failures must not surface as unhandled rejections; a real navigation retries the import.
    prefetchedViews.delete(view)
  })
}
