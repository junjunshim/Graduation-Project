import { Link, NavLink } from 'react-router-dom'
import { Icon } from '../../design-system/primitives/Icon'
import type { WorkspaceOverview } from '../../features/workspace/model/types'
import { navigationItems } from '../navigation'
import styles from './AppShell.module.css'

type ShellSidebarProps = {
  overview: WorkspaceOverview
  isCollapsed: boolean
  onToggleCollapsed: () => void
  onSignOut: () => void
}

export function ShellSidebar({ overview, isCollapsed, onToggleCollapsed, onSignOut }: ShellSidebarProps) {
  const workspaceLabel = overview.rootNode?.name ?? '개인 워크스페이스'
  const expandSidebarLabel = '사이드바 펼치기'
  const collapseSidebarLabel = '사이드바 접기'
  const signOutLabel = '로그아웃'
  const recentWorkItems = overview.recentWorkItems.slice(0, 4)

  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarInner}>
        <div className={styles.sidebarTop}>
          {!isCollapsed ? (
            <button
              type="button"
              className={styles.workspaceSelect}
              aria-label={`현재 워크스페이스: ${workspaceLabel}`}
            >
              <span className={styles.workspaceSelectText}>{workspaceLabel}</span>
              <Icon name="chevronDown" size={16} />
            </button>
          ) : null}

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
                <span className={styles.navCopy}>{item.label}</span>
              </NavLink>
            ))}
          </nav>
        </div>

        <section className={styles.workspaceList} aria-label="내 워크 스페이스">
          <div className={styles.workspaceListHeader}>
            <h2>내 워크 스페이스</h2>
            <Link
              to="/work-items/new"
              className={[styles.workspaceListAdd, styles.tooltipAnchor].join(' ')}
              data-tooltip="업무 등록"
            >
              <Icon name="plus" size={14} />
              <span className={styles.srOnly}>업무 등록</span>
            </Link>
          </div>

          <div className={styles.recentWorkItems}>
            {recentWorkItems.length > 0 ? (
              recentWorkItems.map((item) => (
                <Link key={item.workItemId} to={`/work-items/${item.workItemId}`} className={styles.recentWorkItem}>
                  <span>#</span>
                  <strong>{item.title}</strong>
                </Link>
              ))
            ) : (
              <p className={styles.recentWorkItemEmpty}>최근 업무가 없습니다.</p>
            )}
          </div>
        </section>

        <div className={styles.sidebarBottom}>
          <button
            type="button"
            className={[styles.sidebarActionButton, isCollapsed ? styles.tooltipAnchor : ''].filter(Boolean).join(' ')}
            onClick={onSignOut}
            aria-label={signOutLabel}
            data-tooltip={isCollapsed ? signOutLabel : undefined}
          >
            <Icon name="logOut" size={16} />
            <span>로그아웃</span>
          </button>

          <button
            type="button"
            className={[styles.sidebarActionButton, styles.sidebarCollapseButton, styles.tooltipAnchor].join(' ')}
            onClick={onToggleCollapsed}
            aria-label={isCollapsed ? expandSidebarLabel : collapseSidebarLabel}
            aria-expanded={!isCollapsed}
            data-tooltip={isCollapsed ? expandSidebarLabel : undefined}
          >
            <Icon name={isCollapsed ? 'chevronRight' : 'chevronLeft'} size={16} />
            <span>{isCollapsed ? '열기' : '접기'}</span>
          </button>
        </div>
      </div>
    </aside>
  )
}
