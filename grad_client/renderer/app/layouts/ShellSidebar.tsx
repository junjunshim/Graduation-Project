import { Link, NavLink, useLocation } from 'react-router-dom'
import { Icon } from '../../design-system/primitives/Icon'
import { SidebarFavorites } from './SidebarFavorites'
import { navigationItems } from '../navigation'
import styles from './AppShell.module.css'

type ShellSidebarProps = {
  userId: string
  isCollapsed: boolean
  onToggleCollapsed: () => void
  onSignOut: () => void
}

export function ShellSidebar({ userId, isCollapsed, onToggleCollapsed, onSignOut }: ShellSidebarProps) {
  const location = useLocation()
  const expandSidebarLabel = '사이드바 펼치기'
  const collapseSidebarLabel = '사이드바 접기'
  const signOutLabel = '로그아웃'

  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarInner}>
        <div className={styles.sidebarTop}>
          <nav className={styles.navigation} aria-label="주요 메뉴">
            {navigationItems.map((item) => {
              const prefixes = item.activePathPrefixes ?? (item.activePathPrefix ? [item.activePathPrefix] : [])
              const hasPrefixMatching = prefixes.length > 0
              const isSectionActive = Boolean(
                hasPrefixMatching &&
                  prefixes.some(
                    (prefix) =>
                      location.pathname === prefix || location.pathname.startsWith(`${prefix}/`),
                  ),
              )
              const linkContent = (
                <>
                  <span className={styles.navIcon}>
                    <Icon name={item.icon} size={16} />
                  </span>
                  <span className={styles.navCopy}>{item.label}</span>
                </>
              )

              if (item.disabled) {
                return (
                  <span
                    key={item.to}
                    role="link"
                    aria-disabled="true"
                    aria-label={isCollapsed ? item.label : undefined}
                    data-tooltip={isCollapsed ? item.label : undefined}
                    className={[styles.navItem, isCollapsed ? styles.tooltipAnchor : ''].filter(Boolean).join(' ')}
                  >
                    {linkContent}
                  </span>
                )
              }

              if (hasPrefixMatching) {
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    aria-label={isCollapsed ? item.label : undefined}
                    aria-current={isSectionActive ? 'page' : undefined}
                    data-tooltip={isCollapsed ? item.label : undefined}
                    className={[
                      styles.navItem,
                      isCollapsed ? styles.tooltipAnchor : '',
                      isSectionActive ? styles.navItemActive : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {linkContent}
                  </Link>
                )
              }

              return (
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
                  {linkContent}
                </NavLink>
              )
            })}
          </nav>
        </div>

        <SidebarFavorites key={userId} userId={userId} />

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
