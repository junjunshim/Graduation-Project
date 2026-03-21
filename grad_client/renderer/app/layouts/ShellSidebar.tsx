import { NavLink } from 'react-router-dom'
import { Icon } from '../../design-system/primitives/Icon'
import type { WorkspaceOverview, WorkspaceSummary } from '../../features/workspace/model/types'
import { navigationItems } from '../navigation'
import styles from './AppShell.module.css'

type ShellSidebarProps = {
  currentUser: {
    userId: string
    name: string
    email: string
  }
  summary: WorkspaceSummary
  overview: WorkspaceOverview
  onSignOut: () => void
}

export function ShellSidebar({ currentUser, summary, overview, onSignOut }: ShellSidebarProps) {
  const hasOrgContext = summary.orgNodeCount > 0
  const workspaceLabel = overview.rootNode?.name ?? '개인 워크스페이스'

  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarTop}>
        <div className={styles.brandBlock}>
          <div className={styles.brandMark}>GP</div>
          <div className={styles.brandCopy}>
            <p className={styles.brandEyebrow}>Graduation Project</p>
            <strong className={styles.brandTitle}>Grad Client</strong>
          </div>
        </div>

        <section className={styles.workspaceCard}>
          <p className={styles.cardEyebrow}>현재 워크스페이스</p>
          <strong className={styles.workspaceTitle}>{workspaceLabel}</strong>
          <p className={styles.workspaceText}>
            {hasOrgContext
              ? '공유 공간과 하위 조직을 포함한 작업 문서입니다.'
              : '개인 공간이 준비되어 있으며 첫 공유 공간을 기다리고 있습니다.'}
          </p>
          <div className={styles.workspaceMeta}>
            <span>{currentUser.name}</span>
            <span>{currentUser.userId}</span>
          </div>
        </section>

        <nav className={styles.navigation} aria-label="주요 메뉴">
          {navigationItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                [styles.navItem, isActive ? styles.navItemActive : ''].filter(Boolean).join(' ')
              }
            >
              <span className={styles.navIcon}>
                <Icon name={item.icon} size={16} />
              </span>
              <span className={styles.navCopy}>
                <strong>{item.label}</strong>
                <span>{item.description}</span>
              </span>
            </NavLink>
          ))}
        </nav>
      </div>

      <div className={styles.sidebarBottom}>
        <section className={styles.statsPanel}>
          <div className={styles.statRow}>
            <span>조직</span>
            <strong>{summary.nodeCount}</strong>
          </div>
          <div className={styles.statRow}>
            <span>업무</span>
            <strong>{summary.workItemCount}</strong>
          </div>
          <div className={styles.statRow}>
            <span>권한</span>
            <strong>{summary.roleCount}</strong>
          </div>
          <div className={styles.statRow}>
            <span>평균 진행률</span>
            <strong>{summary.averageProgress}%</strong>
          </div>
        </section>

        <button type="button" className={styles.signOutButton} onClick={onSignOut}>
          로그아웃
        </button>
      </div>
    </aside>
  )
}
