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

export function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const currentUser = getCurrentUser()
  const hasCustomTitleBar = hasCustomWindowControls()

  useBodyScrollSurface(hasCustomTitleBar ? 'workspace' : undefined)

  if (!currentUser) {
    return null
  }

  const summary = getWorkspaceSummary(currentUser.userId)
  const overview = getWorkspaceOverview(currentUser.userId)
  const hasOrgContext = summary.orgNodeCount > 0
  const pageMeta = getShellPageMeta(location.pathname, hasOrgContext)
  const workspaceLabel = overview.rootNode?.name ?? '개인 워크스페이스'

  function handleSignOut() {
    signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className={[styles.shell, hasCustomTitleBar ? styles.shellWithCustomChrome : ''].filter(Boolean).join(' ')}>
      {hasCustomTitleBar ? (
        <div className={styles.titleBarSlot}>
          <WindowTitleBar
            variant="workspace"
            contextLabel={`${workspaceLabel} / ${pageMeta.section}`}
            pageTitle={pageMeta.title}
            actionLabel={pageMeta.actionLabel}
            actionTo={pageMeta.actionTo}
            userName={currentUser.name}
            userEmail={currentUser.email}
          />
        </div>
      ) : null}

      <ShellSidebar currentUser={currentUser} summary={summary} overview={overview} onSignOut={handleSignOut} />

      <div
        className={[styles.workspace, hasCustomTitleBar ? styles.workspaceWithoutPageBar : '']
          .filter(Boolean)
          .join(' ')}
      >
        {!hasCustomTitleBar ? (
          <WorkspacePageHeader currentUser={currentUser} workspaceLabel={workspaceLabel} pageMeta={pageMeta} />
        ) : null}

        <main className={styles.main}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
