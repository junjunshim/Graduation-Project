import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import { UserAvatar } from '../../../design-system/primitives/UserAvatar'
import { getCurrentUser } from '../../auth/api'
import { WorkspaceFilesTab } from '../components/WorkspaceFilesTab'
import { WorkspaceMembersTab } from '../components/WorkspaceMembersTab'
import { WorkspaceRolesTab } from '../components/WorkspaceRolesTab'
import { WorkspaceSchedulesTab } from '../components/WorkspaceSchedulesTab'
import { WorkspaceTasksTab } from '../components/WorkspaceTasksTab'
import { WorkspaceTimelineTab } from '../components/WorkspaceTimelineTab'
import { fetchNodeDetail, getOrgSnapshot } from '../data/orgService'
import {
  subscribeToWorkspaceCache,
  subscribeToLiveNotifications,
  notifyRecurringCacheUpdated,
} from '../data/workspaceCacheEvents'
import {
  getActiveWorkspaceRootId,
  getDefaultWorkspaceRootId,
} from '../data/workspaceDirectorySelection'
import { getWorkspaceOverview } from '../queries/workspaceOverview'
import { useWorkItemContextMenu } from '../components/useWorkItemContextMenu'
import { WorkspaceOverviewTab } from '../components/WorkspaceOverviewTab'
import styles from './WorkspacePage.module.css'

type WorkspaceView = 'overview' | 'tasks' | 'timeline' | 'schedules' | 'files' | 'members' | 'roles'

type WorkspaceTab = {
  label: string
  to: string
  view?: WorkspaceView
}

const workspaceTabs: WorkspaceTab[] = [
  { label: '개요', to: '/workspace', view: 'overview' },
  { label: '업무', to: '/workspace?view=tasks', view: 'tasks' },
  { label: '타임라인', to: '/workspace?view=timeline', view: 'timeline' },
  { label: '일정', to: '/workspace?view=schedules', view: 'schedules' },
  { label: '파일', to: '/workspace?view=files', view: 'files' },
  { label: '사용자', to: '/workspace?view=members', view: 'members' },
  { label: '역할/권한', to: '/workspace?view=roles', view: 'roles' },
  { label: '설정', to: '/settings' },
]

export function WorkspacePage() {
  const [snapshot, setSnapshot] = useState(() => getOrgSnapshot())
  const currentUser = getCurrentUser(snapshot)
  const [searchParams] = useSearchParams()
  const workspaceRootParam = searchParams.get('rootId') || searchParams.get('nodeId')
  const activeWorkspaceRootId =
    workspaceRootParam ??
    getActiveWorkspaceRootId(currentUser?.userId) ??
    getDefaultWorkspaceRootId(currentUser?.userId)
  const requestedView = searchParams.get('view')
  const requestedStatus = searchParams.get('status')
  const requestedSchedule = searchParams.get('schedule')
  const activeView: WorkspaceView =
    requestedView === 'tasks' ||
    requestedView === 'timeline' ||
    requestedView === 'schedules' ||
    requestedView === 'files' ||
    requestedView === 'members' ||
    requestedView === 'roles'
      ? requestedView
      : 'overview'

  const [isLoading, setIsLoading] = useState(false)
  const [errorInfo, setErrorInfo] = useState<string | null>(null)
  const [reloadTrigger, setReloadTrigger] = useState(0)

  useEffect(() => {
    let isSubscribed = true

    if (activeWorkspaceRootId) {
      // 1. 초기 렌더링된 snapshot 기준으로 해당 노드가 캐시에 있는지 확인 (추가적인 getOrgSnapshot() 호출 생략)
      const hasNodeInSnapshot = snapshot.nodes.some(
        (node) => String(node.id) === String(activeWorkspaceRootId),
      )

      // 캐시된 노드가 없는 첫 진입 시에만 로딩 상태 활성화
      if (!hasNodeInSnapshot) {
        setIsLoading(true)
      }
      setErrorInfo(null)

      // 2. 즉각적인 비동기 API 요청 수행
      fetchNodeDetail(activeWorkspaceRootId)
        .then((latestSnapshot) => {
          if (isSubscribed) {
            setSnapshot(latestSnapshot)
            setErrorInfo(null)
          }
        })
        .catch((error) => {
          console.warn('[WorkspacePage] 노드 상세 데이터 조회 실패:', error)
          if (isSubscribed) {
            if (!hasNodeInSnapshot) {
              setErrorInfo(error instanceof Error ? error.message : '노드 상세 정보를 불러오지 못했습니다.')
            }
          }
        })
        .finally(() => {
          if (isSubscribed) {
            setIsLoading(false)
          }
        })
    } else {
      setIsLoading(false)
      setErrorInfo(null)
    }

    // 캐시 변경 이벤트(다른 탭/백그라운드 동기화 발생 시) 부드럽게 동기화
    const unsubscribeCache = subscribeToWorkspaceCache(() => {
      if (isSubscribed) {
        setSnapshot(getOrgSnapshot())
      }
    })

    // 실시간 WebSocket 알림 수신 시 현재 열람 중인 노드 데이터 자동 최신화
    const unsubscribeLive = subscribeToLiveNotifications((payload) => {
      if (!isSubscribed || !activeWorkspaceRootId) return

      const notifNodeId = payload.node_id != null ? Number(payload.node_id) : null
      const currentNodeId = Number(activeWorkspaceRootId)

      // 알림의 소속 노드가 현재 보고 있는 노드와 일치할 때
      if (notifNodeId === currentNodeId) {
        // 1. 일정 관련 알림 (일정 생성/수정/삭제/복구 또는 일정 양식 파일)인 경우:
        //    일정 전용 캐시 갱신 브로드캐스트만 수행 (fetchNodeDetail 중복 호출 방지)
        const isRecurringEvent =
          payload.link_url?.includes('view=schedules') ||
          payload.target_name?.includes('정기') ||
          payload.target_name?.includes('recurring')

        if (isRecurringEvent) {
          notifyRecurringCacheUpdated(currentNodeId)
        } else {
          // 2. 일반 업무, 노드, 권한, 파일 등 일반 노드 활동인 경우에만 fetchNodeDetail 호출
          fetchNodeDetail(activeWorkspaceRootId)
            .then((latestSnapshot) => {
              if (isSubscribed) {
                setSnapshot(latestSnapshot)
              }
            })
            .catch((err) => {
              console.warn('[WorkspacePage] 실시간 알림 수신 후 자동 최신화 실패:', err)
            })
        }
      }
    })

    return () => {
      isSubscribed = false
      unsubscribeCache()
      unsubscribeLive()
    }
  }, [activeWorkspaceRootId, reloadTrigger])

  if (!currentUser) {
    return null
  }

  // 1. 첫 진입 로딩 화면
  if (isLoading) {
    return (
      <section className={styles.page}>
        <div className={styles.loadingStateContainer} role="status">
          <div className={styles.spinnerLarge} aria-hidden="true" />
          <p className={styles.loadingStateText}>워크스페이스 데이터를 불러오는 중입니다...</p>
        </div>
      </section>
    )
  }

  // 2. 진입 실패 에러 화면 (권한 없음, 서버 장애 등)
  if (errorInfo) {
    return (
      <section className={styles.page}>
        <div className={styles.errorStateContainer} role="alert">
          <Icon name="alertTriangle" size={40} className={styles.errorStateIcon} />
          <h2 className={styles.errorStateTitle}>워크스페이스 로드 실패</h2>
          <p className={styles.errorStateMessage}>{errorInfo}</p>
          <button
            type="button"
            className={styles.retryButton}
            onClick={() => setReloadTrigger((count) => count + 1)}
          >
            <Icon name="sparkles" size={16} />
            다시 시도
          </button>
        </div>
      </section>
    )
  }

  // 사용자가 URL 등으로 상위 조상 식별용 노드에 직접 진입을 시도한 경우 차단 화면
  if (activeWorkspaceRootId) {
    const targetNodeId = Number(activeWorkspaceRootId)
    if (Number.isFinite(targetNodeId)) {
      const userRoles = snapshot.roles.filter(
        (r) => !r.isDeleted && (r.userId === currentUser.userId || r.userId.toLowerCase() === currentUser.userId.toLowerCase()),
      )
      const directlyAssignedNodeIds = new Set(userRoles.map((r) => r.nodeId))
      const targetNode = snapshot.nodes.find((n) => n.id === targetNodeId)

      const isDirect = directlyAssignedNodeIds.has(targetNodeId)
      const isInherited = targetNode?.path && Array.isArray(targetNode.path)
        ? targetNode.path.some((ancestorId) => ancestorId !== targetNodeId && directlyAssignedNodeIds.has(ancestorId))
        : false

      if (!isDirect && !isInherited && targetNode) {
        return (
          <section className={styles.page}>
            <div className={styles.errorStateContainer} role="alert">
              <Icon name="lock" size={40} className={styles.errorStateIcon} />
              <h2 className={styles.errorStateTitle}>접근 권한 제한</h2>
              <p className={styles.errorStateMessage}>
                &apos;{targetNode.name}&apos; 노드는 상위 계층 식별 전용 공간으로, 상세 워크스페이스 진입 권한이 없습니다.
              </p>
              <Link to="/workspace/select" className={styles.retryButton}>
                <Icon name="folder" size={16} />
                워크스페이스 목록으로 이동
              </Link>
            </div>
          </section>
        )
      }
    }
  }

  const overview = useMemo(
    () =>
      getWorkspaceOverview(currentUser.userId, snapshot, {
        rootNodeId: activeWorkspaceRootId,
        singleNodeOnly: true,
      }),
    [currentUser.userId, snapshot, activeWorkspaceRootId],
  )
  const displayRoleMembers = overview.rootRoleMembers.length > 0
    ? overview.rootRoleMembers
    : overview.allRoleMembers && overview.allRoleMembers.length > 0
      ? overview.allRoleMembers
      : []
  const visibleMembers = displayRoleMembers.slice(0, 4)
  const totalMemberCount = overview.allRoleMembers ? overview.allRoleMembers.length : overview.rootRoleMembers.length
  const extraMemberCount = Math.max(0, totalMemberCount - visibleMembers.length)
  const { workItemContextMenu } = useWorkItemContextMenu()

  return (
    <section
      className={[
        styles.page,
        styles.fullHeightPage,
        activeView === 'overview' ? styles.overviewPage : '',
        activeView === 'timeline' ? styles.timelinePage : '',
        activeView === 'tasks' ? styles.tasksPage : '',
        activeView === 'schedules' ? styles.schedulesPage : '',
        activeView === 'files' ? styles.filesPage : '',
        activeView === 'members' ? styles.membersPage : '',
        activeView === 'roles' ? styles.rolesPage : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {workItemContextMenu}
      <div className={styles.workspaceNavBar}>
        <nav className={styles.workspaceTabs} aria-label="워크스페이스 보기">
          {workspaceTabs.map((tab) => {
            const isActive = tab.view === activeView
            const targetTo =
              workspaceRootParam && tab.to.startsWith('/workspace')
                ? tab.to.includes('?')
                  ? `${tab.to}&nodeId=${encodeURIComponent(workspaceRootParam)}`
                  : `${tab.to}?nodeId=${encodeURIComponent(workspaceRootParam)}`
                : tab.to

            return (
              <Link
                key={tab.label}
                to={targetTo}
                className={[styles.tabLink, isActive ? styles.tabLinkActive : ''].filter(Boolean).join(' ')}
                aria-current={isActive ? 'page' : undefined}
              >
                {tab.label}
              </Link>
            )
          })}
        </nav>

        <div className={styles.headerActions}>
          <div
            className={styles.memberStack}
            aria-label="워크스페이스 멤버"
            title={
              overview.allRoleMembers && overview.allRoleMembers.length !== overview.rootRoleMembers.length
                ? `직속 팀원 ${overview.rootRoleMembers.length}명 / 하위 포함 전체 ${totalMemberCount}명`
                : `팀원 ${totalMemberCount}명`
            }
          >
            {visibleMembers.map((member) => (
              <span
                key={`${member.assignmentId}-${member.userId}`}
                data-member-name={member.name}
              >
                <UserAvatar name={member.name} userId={member.userId} size="medium" />
                <span className={styles.memberName}>{member.name}</span>
              </span>
            ))}
            {extraMemberCount > 0 ? <strong data-member-name={`외 ${extraMemberCount}명 (전체 ${totalMemberCount}명)`}>+{extraMemberCount}</strong> : null}
          </div>

          <button type="button" className={styles.secondaryAction}>
            <Icon name="users" size={15} />
            공유
          </button>
          <button type="button" className={styles.iconAction} aria-label="더보기">
            <span className={styles.moreDots} aria-hidden="true" />
          </button>
        </div>
      </div>

      {activeView === 'timeline' ? (
        <WorkspaceTimelineTab
          workItems={overview.visibleWorkItems}
          nodes={overview.visibleNodes}
          members={overview.allRoleMembers && overview.allRoleMembers.length > 0 ? overview.allRoleMembers : overview.rootRoleMembers}
        />
      ) : activeView === 'tasks' ? (
        <WorkspaceTasksTab
          key={[requestedStatus ?? 'all-status', requestedSchedule ?? 'all-schedule'].join('-')}
          createHref={overview.rootNode ? `/work-items/new?nodeId=${overview.rootNode.id}` : '/work-items/new'}
          workItems={overview.visibleWorkItems}
          deletedWorkItems={overview.deletedWorkItems}
          allWorkItems={overview.allWorkItems}
          members={snapshot.users}
          filterMembers={overview.allRoleMembers ?? overview.rootRoleMembers}
          workspaces={overview.visibleNodes}
          initialStatus={requestedStatus ?? undefined}
          initialSchedule={requestedSchedule ?? undefined}
        />
      ) : activeView === 'schedules' ? (
        <WorkspaceSchedulesTab
          activeNodeId={overview.rootNode ? overview.rootNode.id : 1}
          members={overview.allRoleMembers && overview.allRoleMembers.length > 0 ? overview.allRoleMembers : overview.rootRoleMembers}
          workspaces={overview.visibleNodes}
        />
      ) : activeView === 'files' ? (
        <WorkspaceFilesTab
          nodeId={overview.rootNode ? overview.rootNode.id : (activeWorkspaceRootId ? Number(activeWorkspaceRootId) : 1)}
          workItems={overview.visibleWorkItems}
          files={overview.allFiles ?? overview.files}
        />
      ) : activeView === 'members' ? (
        <WorkspaceMembersTab
          rootNode={overview.rootNode}
          nodes={overview.visibleNodes}
          roles={snapshot.roles}
          users={snapshot.users}
          authorities={snapshot.authorities}
        />
      ) : activeView === 'roles' ? (
        <WorkspaceRolesTab
          rootNode={overview.rootNode}
          authorities={snapshot.authorities}
          roles={snapshot.roles}
          currentUserId={currentUser.userId}
          currentUser={currentUser}
        />
      ) : (
        <WorkspaceOverviewTab overview={overview} snapshot={snapshot} currentUserId={currentUser.userId} />
      )}
    </section>
  )
}
