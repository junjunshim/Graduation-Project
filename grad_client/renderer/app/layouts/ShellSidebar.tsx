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
  isCollapsed: boolean
  onToggleCollapsed: () => void
  onSignOut: () => void
}

export function ShellSidebar({
  currentUser,
  summary,
  overview,
  isCollapsed,
  onToggleCollapsed,
  onSignOut,
}: ShellSidebarProps) {
  const hasOrgContext = summary.orgNodeCount > 0
  const workspaceLabel = overview.rootNode?.name ?? '개인 워크스페이스'
  const expandSidebarLabel = '사이드바 펼치기'
  const collapseSidebarLabel = '사이드바 축소'
  const signOutLabel = '로그아웃'

  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarInner}>
        <div className={styles.sidebarTop}>
          <div className={styles.brandHeader}>
            {isCollapsed ? (
              <button
                type="button"
                className={[styles.brandMark, styles.brandMarkButton, styles.tooltipAnchor].join(' ')}
                onClick={onToggleCollapsed}
                aria-label={expandSidebarLabel}
                data-tooltip={expandSidebarLabel}
              >
                <span className={styles.brandMarkText}>GP</span>
                <span className={styles.brandMarkExpandIcon}>
                  <Icon name="chevronRight" size={14} />
                </span>
              </button>
            ) : (
              <>
                <div className={styles.brandBlock}>
                  <div className={styles.brandMark}>GP</div>
                </div>

                <button
                  type="button"
                  className={[styles.sidebarToggle, styles.tooltipAnchor].join(' ')}
                  onClick={onToggleCollapsed}
                  aria-label={collapseSidebarLabel}
                  aria-expanded={!isCollapsed}
                  data-tooltip={collapseSidebarLabel}
                >
                  <Icon name="chevronLeft" size={16} />
                </button>
              </>
            )}
          </div>

          <section className={styles.workspaceCard}>
            <p className={styles.cardEyebrow}>현재 워크스페이스</p>
            <strong className={styles.workspaceTitle}>{workspaceLabel}</strong>
            <p className={styles.workspaceText}>
              {hasOrgContext
                ? '공유 공간과 하위 조직을 포함한 작업 현황을 한곳에서 확인할 수 있습니다.'
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
                aria-label={isCollapsed ? item.label : undefined}
                data-tooltip={isCollapsed ? item.label : undefined}
                className={({ isActive }) =>
                  [
                    styles.navItem,
                    isCollapsed ? styles.tooltipAnchor : '',
                    isActive ? styles.navItemActive : '',
                  ]
                    .filter(Boolean)
                    .join(' ')
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

          <button
            type="button"
            className={[styles.signOutButton, isCollapsed ? styles.tooltipAnchor : ''].filter(Boolean).join(' ')}
            onClick={onSignOut}
            aria-label={signOutLabel}
            data-tooltip={isCollapsed ? signOutLabel : undefined}
          >
            <span className={styles.signOutIcon}>
              <Icon name="logOut" size={16} />
            </span>
            <span className={styles.signOutLabel}>로그아웃</span>
          </button>
        </div>
      </div>
    </aside>
  )
}
