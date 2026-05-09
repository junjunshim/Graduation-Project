import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { WindowTitleBar } from '../chrome/WindowTitleBar'
import { hasCustomWindowControls } from '../chrome/windowControls'
import { useBodyScrollSurface } from '../chrome/useBodyScrollSurface'
import { getCurrentUser, signOut } from '../../features/auth/api'
import { getWorkspaceSummary } from '../../features/workspace/data/orgService'
import { getWorkspaceOverview } from '../../features/workspace/queries/workspaceOverview'
import { ShellSidebar } from './ShellSidebar'
import { WorkspacePageHeader } from './WorkspacePageHeader'
import { getShellPageMeta } from './shellPageMeta'
import styles from './AppShell.module.css'

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'grad-client-sidebar-collapsed'

function readInitialSidebarCollapsed() {
  if (typeof window === 'undefined') {
    return false
  }

  return window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === 'true'
}

export function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const currentUser = getCurrentUser()
  const hasCustomTitleBar = hasCustomWindowControls()
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(readInitialSidebarCollapsed)

  useBodyScrollSurface(hasCustomTitleBar ? 'workspace' : undefined)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, String(isSidebarCollapsed))
  }, [isSidebarCollapsed])

  if (!currentUser) {
    return null
  }

  const summary = getWorkspaceSummary(currentUser.userId)
  const overview = getWorkspaceOverview(currentUser.userId)
  const hasOrgContext = summary.orgNodeCount > 0
  const pageMeta = getShellPageMeta(location.pathname, hasOrgContext)
  const workspaceLabel = overview.rootNode?.name ?? '개인 워크스페이스'
  const shellClassName = [
    styles.shell,
    hasCustomTitleBar ? styles.shellWithCustomChrome : '',
    isSidebarCollapsed ? styles.shellCollapsed : '',
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
        currentUser={currentUser}
        summary={summary}
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

        <main className={styles.main}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
