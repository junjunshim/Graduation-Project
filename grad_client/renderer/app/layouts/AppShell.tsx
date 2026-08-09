import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { WindowTitleBar } from '../chrome/WindowTitleBar'
import { hasCustomWindowControls } from '../chrome/windowControls'
import { useBodyScrollSurface } from '../chrome/useBodyScrollSurface'
import { getCurrentUser, signOut } from '../../features/auth/api'
import { getOrgSnapshot } from '../../features/workspace/data/orgService'
import { getWorkspaceOverview } from '../../features/workspace/queries/workspaceOverview'
import { ShellSidebar } from './ShellSidebar'
import { ShellTopActions, type ShellTopActionsHeading } from './ShellTopActions'
import { WorkspacePageHeader } from './WorkspacePageHeader'
import { getShellPageMeta } from './shellPageMeta'
import styles from './AppShell.module.css'

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'grad-client-sidebar-collapsed'
const SECTION_HEADING_ROUTES = new Set([
  '/work-items',
  '/calendar',
  '/documents',
  '/files',
  '/settings',
])

function readInitialSidebarCollapsed() {
  if (typeof window === 'undefined') {
    return false
  }

  return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true'
}

export function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const snapshot = getOrgSnapshot()
  const currentUser = getCurrentUser(snapshot)
  const hasCustomTitleBar = hasCustomWindowControls()
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(readInitialSidebarCollapsed)

  useBodyScrollSurface('workspace')

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(isSidebarCollapsed))
  }, [isSidebarCollapsed])

  if (!currentUser) {
    return null
  }

  const overview = getWorkspaceOverview(currentUser.userId, snapshot)
  const summary = overview.summary
  const hasOrgContext = summary.orgNodeCount > 0
  const pageMeta = getShellPageMeta(location.pathname, hasOrgContext)
  const workspaceLabel = overview.rootNode?.name ?? '개인 워크스페이스'
  const isWorkspaceRoute = location.pathname === '/workspace'
  const isWorkspaceTimelineRoute =
    isWorkspaceRoute && new URLSearchParams(location.search).get('view') === 'timeline'
  const hasSectionHeading = SECTION_HEADING_ROUTES.has(location.pathname)
  const shellHeading: ShellTopActionsHeading = isWorkspaceRoute
    ? {
        type: 'breadcrumb',
        label: '워크 스페이스',
        title: workspaceLabel,
        subtitle: '공동작업을 위한 워크스페이스',
      }
    : location.pathname === '/dashboard'
      ? { type: 'greeting' }
      : hasSectionHeading
        ? {
            type: 'page',
            title: pageMeta.title,
            subtitle: pageMeta.description,
          }
        : { type: 'none' }
  const shellClassName = [
    styles.shell,
    hasCustomTitleBar ? styles.shellWithCustomChrome : '',
    isSidebarCollapsed ? styles.shellCollapsed : '',
    isWorkspaceTimelineRoute ? styles.shellTimeline : '',
  ]
    .filter(Boolean)
    .join(' ')

  function handleSignOut() {
    signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className={shellClassName}>
      {hasCustomTitleBar ? (
        <div className={styles.titleBarSlot}>
          <WindowTitleBar
            variant="workspace"
          />
        </div>
      ) : null}

      <ShellSidebar
        overview={overview}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapsed={() => setIsSidebarCollapsed((current) => !current)}
        onSignOut={handleSignOut}
      />

      <div
        className={[styles.workspace, hasCustomTitleBar ? styles.workspaceWithoutPageBar : '']
          .filter(Boolean)
          .join(' ')}
      >
        {!hasCustomTitleBar ? <WorkspacePageHeader workspaceLabel={workspaceLabel} pageMeta={pageMeta} /> : null}

        <div
          className={[styles.workspaceBody, isWorkspaceTimelineRoute ? styles.workspaceBodyTimeline : '']
            .filter(Boolean)
            .join(' ')}
        >
          <ShellTopActions
            currentUser={currentUser}
            heading={shellHeading}
            inset="standard"
          />

          <main className={[styles.main, isWorkspaceTimelineRoute ? styles.mainTimeline : ''].filter(Boolean).join(' ')}>
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  )
}
