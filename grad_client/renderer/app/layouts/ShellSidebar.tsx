import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useSearchParams } from 'react-router-dom'
import { Icon } from '../../design-system/primitives/Icon'
import { SidebarFavorites } from './SidebarFavorites'
import { navigationItems } from '../navigation'
import { getOrgSnapshot } from '../../features/workspace/data/orgService'
import { subscribeToWorkspaceCache } from '../../features/workspace/data/workspaceCacheEvents'
import { getNodeVisualMetadata } from '../../features/workspace/queries/workspaceDirectory'
import {
  getLastVisitedWorkspaceNodeId,
} from '../../features/workspace/data/workspaceDirectorySelection'
import {
  WORKSPACE_SUB_TABS,
  getWorkspaceTabPermissions,
} from '../../features/workspace/model/workspaceTabModel'
import styles from './AppShell.module.css'

type ShellSidebarProps = {
  userId: string
  isCollapsed: boolean
  onToggleCollapsed: () => void
  onSignOut: () => void
}

export function ShellSidebar({ userId, isCollapsed, onToggleCollapsed, onSignOut }: ShellSidebarProps) {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const expandSidebarLabel = '사이드바 펼치기'
  const collapseSidebarLabel = '사이드바 접기'
  const signOutLabel = '로그아웃'

  const [snapshot, setSnapshot] = useState(() => getOrgSnapshot())
  const [visitedNodeId, setVisitedNodeId] = useState<string | null>(() => getLastVisitedWorkspaceNodeId(userId))

  useEffect(() => {
    const updateSnapshot = () => setSnapshot(getOrgSnapshot())
    const unsubscribeCache = subscribeToWorkspaceCache(updateSnapshot)
    const handleVisited = (e: Event) => {
      const customEvent = e as CustomEvent<{ nodeId: string }>
      if (customEvent.detail?.nodeId) {
        setVisitedNodeId(customEvent.detail.nodeId)
      }
    }
    window.addEventListener('grad-client-workspace-visited', handleVisited)
    return () => {
      unsubscribeCache()
      window.removeEventListener('grad-client-workspace-visited', handleVisited)
    }
  }, [])

  // 워크스페이스 상세 라우트(/workspace, /work-items 등)에 머물고 있는지 여부
  const isInsideWorkspace =
    location.pathname.startsWith('/workspace') ||
    location.pathname.startsWith('/work-items') ||
    location.pathname.startsWith('/setup/sub-node') ||
    location.pathname.startsWith('/setup/top-node')

  // 사용자가 수동으로 접거나 펼친 토글 상태 관리
  const [manualSubNavMap, setManualSubNavMap] = useState<Record<string, boolean>>({})

  // 현재 라우트에 따른 펼침 여부 (수동 조작 기록이 없으면 워크스페이스 내부 진입 시 항상 자연스럽게 열림)
  const isSubNavExpanded = manualSubNavMap[location.pathname] !== undefined
    ? manualSubNavMap[location.pathname]
    : isInsideWorkspace

  // 현재 URL에 nodeId가 있으면 우선 반영
  const urlNodeId = location.pathname.startsWith('/workspace')
    ? (searchParams.get('nodeId') || searchParams.get('rootId'))
    : null
  const effectiveNodeId = urlNodeId || visitedNodeId
  const activeNode = effectiveNodeId
    ? snapshot.nodes.find((n) => String(n.id) === String(effectiveNodeId) && !n.isDeleted)
    : null

  // 활성 노드에 대한 서브 탭 권한 계산
  const tabPermissions = activeNode
    ? getWorkspaceTabPermissions(userId, activeNode.id, snapshot)
    : null

  const currentView = location.pathname === '/workspace'
    ? (searchParams.get('view') || 'overview')
    : null
  const currentTaskMode = location.pathname === '/workspace' && currentView === 'tasks'
    ? (searchParams.get('mode') === 'tree' ? 'tree' : 'list')
    : null

  return (
    <aside className={styles.sidebar}>
      <div className={styles.sidebarInner}>
        <div className={styles.sidebarTop}>
          <nav className={styles.navigation} aria-label="주요 메뉴">
            {navigationItems.map((item) => {
              const prefixes = item.activePathPrefixes ?? (item.activePathPrefix ? [item.activePathPrefix] : [])
              const hasPrefixMatching = prefixes.length > 0
              const matchesActivePattern = Boolean(
                item.activePathPatterns?.some((pattern) => pattern.test(location.pathname)),
              )
              const isSectionActive = Boolean(
                matchesActivePattern ||
                  (hasPrefixMatching &&
                    prefixes.some(
                      (prefix) =>
                        location.pathname === prefix || location.pathname.startsWith(`${prefix}/`),
                    )),
              )
              const linkContent = (
                <>
                  <span className={styles.navIcon}>
                    <Icon name={item.icon} size={16} />
                  </span>
                  <span className={styles.navCopy}>{item.label}</span>
                </>
              )

              const isWorkspaceMenuItem = item.to === '/workspace/select'

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

              const mainItemNode = hasPrefixMatching ? (
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
              ) : (
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

              // 워크스페이스 메뉴 항목이면서, 활성 워크스페이스가 있고 사이드바가 펼쳐진 상태일 때 하위 탭 렌더링
              if (isWorkspaceMenuItem && activeNode && !isCollapsed) {
                return (
                  <div key={item.to} className={styles.workspaceMenuBlock}>
                    {mainItemNode}
                    <div className={styles.workspaceSubNav} role="group" aria-label={`${activeNode.name} 서브 탭`}>
                      <button
                        type="button"
                        className={styles.workspaceActiveNodeHeader}
                        title={`워크스페이스 하위 탭 ${isSubNavExpanded ? '접기' : '펼치기'}: ${activeNode.name}`}
                        aria-expanded={isSubNavExpanded}
                        onClick={() =>
                          setManualSubNavMap((prev) => ({
                            ...prev,
                            [location.pathname]: !isSubNavExpanded,
                          }))
                        }
                      >
                        <span className={styles.workspaceActiveNodeHeaderLeft}>
                          <Icon
                            name={getNodeVisualMetadata(activeNode.nodeType).iconName}
                            size={14}
                            className={styles.workspaceActiveNodeIcon}
                          />
                          <span className={styles.workspaceActiveNodeName}>{activeNode.name}</span>
                        </span>
                        <Icon
                          name="chevronDown"
                          size={12}
                          className={[
                            styles.workspaceActiveNodeChevron,
                            isSubNavExpanded ? styles.workspaceActiveNodeChevronOpen : '',
                          ].filter(Boolean).join(' ')}
                        />
                      </button>

                      <div
                        className={[
                          styles.workspaceSubNavCollapse,
                          isSubNavExpanded ? styles.workspaceSubNavCollapseOpen : '',
                        ].filter(Boolean).join(' ')}
                      >
                        <div className={styles.workspaceSubNavCollapseInner}>
                          {WORKSPACE_SUB_TABS.map((subTab) => {
                            const isAllowed = tabPermissions ? tabPermissions[subTab.view] : true
                            const isSubActive =
                              location.pathname === '/workspace' &&
                              String(urlNodeId ?? effectiveNodeId) === String(activeNode.id) &&
                              currentView === subTab.view

                            const isTaskTab = subTab.view === 'tasks'

                            const targetHref = subTab.view === 'overview'
                              ? `/workspace?nodeId=${activeNode.id}`
                              : `/workspace?nodeId=${activeNode.id}&view=${subTab.view}`

                            if (!isAllowed) {
                              return (
                                <div key={subTab.view}>
                                  <span
                                    className={[styles.subNavItem, styles.subNavItemDisabled].join(' ')}
                                    title={`${subTab.label} 조회 권한이 없습니다`}
                                    aria-disabled="true"
                                  >
                                    <span className={styles.subNavLeft}>
                                      <span className={styles.subNavIcon}>
                                        <Icon name={subTab.icon} size={13} />
                                      </span>
                                      <span className={styles.subNavLabel}>{subTab.label}</span>
                                    </span>
                                    <Icon name="lock" size={12} className={styles.subNavLockIcon} />
                                  </span>
                                  {isTaskTab && (
                                    <div className={styles.workspaceNestedSubNav}>
                                      <span
                                        className={[styles.nestedSubNavItem, styles.nestedSubNavItemDisabled].join(' ')}
                                        title="업무 조회 권한이 없습니다"
                                        aria-disabled="true"
                                      >
                                        <span className={styles.subNavLeft}>
                                          <span className={styles.subNavIcon}>
                                            <Icon name="list" size={12} />
                                          </span>
                                          <span className={styles.subNavLabel}>업무 목록</span>
                                        </span>
                                        <Icon name="lock" size={11} className={styles.subNavLockIcon} />
                                      </span>
                                      <span
                                        className={[styles.nestedSubNavItem, styles.nestedSubNavItemDisabled].join(' ')}
                                        title="업무 조회 권한이 없습니다"
                                        aria-disabled="true"
                                      >
                                        <span className={styles.subNavLeft}>
                                          <span className={styles.subNavIcon}>
                                            <Icon name="orgChart" size={12} />
                                          </span>
                                          <span className={styles.subNavLabel}>업무 트리</span>
                                        </span>
                                        <Icon name="lock" size={11} className={styles.subNavLockIcon} />
                                      </span>
                                    </div>
                                  )}
                                </div>
                              )
                            }

                            return (
                              <div key={subTab.view}>
                                <Link
                                  to={targetHref}
                                  className={[
                                    styles.subNavItem,
                                    isSubActive ? styles.subNavItemActive : '',
                                  ].filter(Boolean).join(' ')}
                                  aria-current={isSubActive ? 'page' : undefined}
                                >
                                  <span className={styles.subNavLeft}>
                                    <span className={styles.subNavIcon}>
                                      <Icon name={subTab.icon} size={13} />
                                    </span>
                                    <span className={styles.subNavLabel}>{subTab.label}</span>
                                  </span>
                                </Link>

                                {isTaskTab && (
                                  <div className={styles.workspaceNestedSubNav} role="group" aria-label="업무 하위 메뉴">
                                    <Link
                                      to={`/workspace?nodeId=${activeNode.id}&view=tasks&mode=list`}
                                      className={[
                                        styles.nestedSubNavItem,
                                        isSubActive && currentTaskMode === 'list' ? styles.nestedSubNavItemActive : '',
                                      ].filter(Boolean).join(' ')}
                                      aria-current={isSubActive && currentTaskMode === 'list' ? 'page' : undefined}
                                    >
                                      <span className={styles.subNavLeft}>
                                        <span className={styles.subNavIcon}>
                                          <Icon name="list" size={12} />
                                        </span>
                                        <span className={styles.subNavLabel}>업무 목록</span>
                                      </span>
                                    </Link>
                                    <Link
                                      to={`/workspace?nodeId=${activeNode.id}&view=tasks&mode=tree`}
                                      className={[
                                        styles.nestedSubNavItem,
                                        isSubActive && currentTaskMode === 'tree' ? styles.nestedSubNavItemActive : '',
                                      ].filter(Boolean).join(' ')}
                                      aria-current={isSubActive && currentTaskMode === 'tree' ? 'page' : undefined}
                                    >
                                      <span className={styles.subNavLeft}>
                                        <span className={styles.subNavIcon}>
                                          <Icon name="orgChart" size={12} />
                                        </span>
                                        <span className={styles.subNavLabel}>업무 트리</span>
                                      </span>
                                    </Link>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              }

              return mainItemNode
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
