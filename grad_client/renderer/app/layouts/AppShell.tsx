import { useEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { WindowTitleBar } from '../chrome/WindowTitleBar'
import { hasCustomWindowControls } from '../chrome/windowControls'
import { useBodyScrollSurface } from '../chrome/useBodyScrollSurface'
import { getCurrentUser, signOut } from '../../features/auth/api'
import { getOrgSnapshot } from '../../features/workspace/data/orgService'
import { useWorkspaceData } from '../../features/workspace/data/WorkspaceDataProvider'
import {
  getActiveWorkspaceRootId,
  getDefaultWorkspaceRootId,
} from '../../features/workspace/data/workspaceDirectorySelection'
import { getSelectedWorkItemDetail } from '../../features/workspace/queries/selectedWorkItemDetail'
import { getWorkspaceOverview } from '../../features/workspace/queries/workspaceOverview'
import { ShellSidebar } from './ShellSidebar'
import { ShellTopActions, type ShellTopActionsHeading } from './ShellTopActions'
import { NotificationToastContainer } from '../../features/notification/ui/NotificationToast'
import { WorkspacePageHeader } from './WorkspacePageHeader'
import { getShellPageMeta } from './shellPageMeta'
import styles from './AppShell.module.css'

const SIDEBAR_COLLAPSED_STORAGE_KEY = 'grad-client-sidebar-collapsed'
const WORK_ITEM_EDIT_PATH_PATTERN = /^\/work-items\/[^/]+\/edit\/?$/
const SECTION_HEADING_ROUTES = new Set([
  '/work-items/new',
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
  useWorkspaceData()
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const snapshot = getOrgSnapshot()
  const currentUser = getCurrentUser(snapshot)
  const hasCustomTitleBar = hasCustomWindowControls()
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(readInitialSidebarCollapsed)
  // 캘린더 페이지가 셸 헤더의 툴바 자리로 포털할 수 있게 하는 참조.
  const calendarToolbarRef = useRef<HTMLDivElement>(null)

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

  const workspaceRootParam = searchParams.get('rootId') || searchParams.get('nodeId')
  const overview = getWorkspaceOverview(currentUser.userId, snapshot, {
    rootNodeId:
      workspaceRootParam ??
      getActiveWorkspaceRootId(currentUser.userId) ??
      getDefaultWorkspaceRootId(currentUser.userId),
    singleNodeOnly: true,
  })
  const summary = overview.summary
  const hasOrgContext = summary.orgNodeCount > 0
  const pageMeta = getShellPageMeta(location.pathname, hasOrgContext, location.search)
  const workspaceLabel = overview.rootNode?.name ?? '개인 워크스페이스'
  const isWorkspaceSelectRoute = location.pathname === '/workspace/select'
  const workspaceSelectView = searchParams.get('view') === 'list' ? 'list' : 'hierarchy'
  const isWorkspaceSelectListView = workspaceSelectView === 'list'
  const isWorkspaceRoute = location.pathname === '/workspace'
  const isWorkspaceTimelineRoute =
    isWorkspaceRoute && searchParams.get('view') === 'timeline'
  const isWorkspacePanelRoute =
    (isWorkspaceRoute &&
      searchParams.get('view') !== 'timeline') ||
    location.pathname === '/setup/top-node' ||
    location.pathname === '/setup/sub-node'
  const isWorkItemEditRoute = WORK_ITEM_EDIT_PATH_PATTERN.test(location.pathname)
  const hasSectionHeading = SECTION_HEADING_ROUTES.has(location.pathname) || isWorkItemEditRoute
  // 상세(/work-items/:id)와 수정(/work-items/:id/edit) 모두 같은 업무를 가리킨다.
  const workItemRouteMatch = location.pathname.match(/^\/work-items\/([^/]+)(\/edit)?\/?$/)
  const workItemDetail = workItemRouteMatch
    ? getSelectedWorkItemDetail(workItemRouteMatch[1], currentUser.userId, snapshot)
    : null
  const parentNodeParam = searchParams.get('parentNodeId')
  const parentNodeForHeading = parentNodeParam
    ? snapshot.nodes.find((n) => n.id === parseInt(parentNodeParam, 10))
    : null

  const shellHeading: ShellTopActionsHeading = location.pathname === '/setup/sub-node'
    ? {
        type: 'breadcrumb',
        label: '워크스페이스',
        title: '하위 워크스페이스 생성',
        subtitle: parentNodeForHeading
          ? `${parentNodeForHeading.name}의 하위 워크스페이스를 등록합니다.`
          : '부모 워크스페이스의 하위 워크스페이스를 등록합니다.',
      }
    : location.pathname === '/setup/top-node'
    ? {
        type: 'breadcrumb',
        label: '워크스페이스',
        title: '루트 워크스페이스 생성',
        subtitle: '회사, 본부, 프로젝트 등 전체 조직 계층 트리의 기준이 될 최상위 루트 워크스페이스를 등록합니다.',
      }
    : isWorkspaceSelectRoute
    ? {
        type: 'page',
        title: isWorkspaceSelectListView ? '워크스페이스' : '워크스페이스 진입점',
        titleDetail: isWorkspaceSelectListView ? '(목록)' : '(계층도)',
        subtitle: isWorkspaceSelectListView
          ? '조직의 모든 워크스페이스를 목록으로 확인하고 이동할 수 있습니다.'
          : '조직의 모든 워크스페이스를 계층 구조로 확인하고 이동할 수 있습니다.',
      }
    : isWorkspaceRoute
      ? {
          type: 'breadcrumb',
          label: '워크스페이스',
          title: workspaceLabel,
          subtitle: '공동작업을 위한 워크스페이스',
        }
      : location.pathname === '/dashboard'
      ? { type: 'greeting' }
      : workItemDetail
        ? {
            type: 'breadcrumb',
            label: '워크스페이스',
            parent: {
              label: workItemDetail.ownerNode.name,
              to: `/workspace?nodeId=${workItemDetail.ownerNode.id}`,
            },
            title: workItemDetail.item.title,
            titleSuffix: isWorkItemEditRoute ? '(수정)' : undefined,
            subtitle: workItemDetail.ownerNodePathLabel,
          }
      : hasSectionHeading
        ? {
            type: 'page',
            title: pageMeta.title,
            subtitle: pageMeta.description,
          }
        : { type: 'none' }
  const isWorkItemCreateRoute = location.pathname === '/work-items/new'
  const isWorkItemDetailRoute = /^\/work-items\/[^/]+$/.test(location.pathname)
  const isWorkItemFormRoute = isWorkItemCreateRoute || isWorkItemEditRoute
  const isDashboardRoute = location.pathname === '/dashboard'
  const isCalendarRoute = location.pathname === '/calendar'
  const hasInternalScroll =
    isWorkspaceTimelineRoute ||
    isWorkspacePanelRoute ||
    isWorkspaceSelectRoute ||
    isWorkItemFormRoute ||
    isDashboardRoute ||
    isCalendarRoute ||
    isWorkItemDetailRoute
  const shellClassName = [
    styles.shell,
    isWorkspacePanelRoute || isWorkItemFormRoute ? styles.shellWorkspacePanels : '',
    hasCustomTitleBar ? styles.shellWithCustomChrome : '',
    isSidebarCollapsed ? styles.shellCollapsed : '',
    hasInternalScroll ? styles.shellTimeline : '',
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
        userId={currentUser.userId}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapsed={() => setIsSidebarCollapsed((current) => !current)}
        onSignOut={handleSignOut}
      />

      <div
        className={[
          styles.workspace,
          hasCustomTitleBar || isWorkspaceSelectRoute || location.pathname === '/setup/top-node' || location.pathname === '/setup/sub-node'
            ? styles.workspaceWithoutPageBar
            : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {!hasCustomTitleBar && !isWorkspaceSelectRoute && location.pathname !== '/setup/top-node' && location.pathname !== '/setup/sub-node' ? (
          <WorkspacePageHeader workspaceLabel={workspaceLabel} pageMeta={pageMeta} />
        ) : null}

        <div
          className={[
            styles.workspaceBody,
            hasInternalScroll ? styles.workspaceBodyTimeline : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <ShellTopActions
            currentUser={currentUser}
            heading={shellHeading}
            inset="standard"
            actions={
              isCalendarRoute ? (
                <div ref={calendarToolbarRef} className={styles.shellCalendarActions} />
              ) : undefined
            }
          />

          <main
            className={[
              styles.main,
              hasInternalScroll ? styles.mainTimeline : '',
              isWorkItemFormRoute ? styles.mainScrollable : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <Outlet context={{ calendarToolbarRef }} />
          </main>
        </div>
      </div>
      <NotificationToastContainer userId={currentUser.userId} />
    </div>
  )
}
