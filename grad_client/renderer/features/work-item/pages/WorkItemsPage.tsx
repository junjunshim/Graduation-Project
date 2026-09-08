import { Navigate, useSearchParams } from 'react-router-dom'
import { getCurrentUser } from '../../auth/api'
import { WorkspaceTasksTab } from '../../workspace/components/WorkspaceTasksTab'
import { getOrgSnapshot } from '../../workspace/data/orgService'
import { getWorkspaceOverview } from '../../workspace/queries/workspaceOverview'
import styles from './WorkItemsPage.module.css'

export function WorkItemsPage() {
  const [searchParams] = useSearchParams()
  const requestedView = searchParams.get('view')
  const requestedStatus = searchParams.get('status')
  const requestedSchedule = searchParams.get('schedule')

  // 기존 ?view=create 접근 시 /work-items/new 로 자동 리다이렉트
  if (requestedView === 'create') {
    return <Navigate to="/work-items/new" replace />
  }

  const snapshot = getOrgSnapshot()
  const currentUser = getCurrentUser(snapshot)
  const overview = currentUser ? getWorkspaceOverview(currentUser.userId, snapshot) : null
  const visibleOwnerIds = new Set(overview?.visibleWorkItems.map((item) => item.ownerUserId) ?? [])
  const visibleMembers = snapshot.users.filter((user) => visibleOwnerIds.has(user.userId))

  return (
    <section className={styles.page}>
      <div className={styles.tabContent}>
        {overview ? (
          <WorkspaceTasksTab
            key={[requestedStatus ?? 'all-status', requestedSchedule ?? 'all-schedule'].join('-')}
            workItems={overview.visibleWorkItems}
            members={visibleMembers}
            workspaces={overview.visibleNodes}
            tableLabel="접근 가능한 전체 업무 목록"
            createHref="/work-items/new"
            filterLayout="toolbar"
            showHeading={false}
            initialStatus={requestedStatus}
            initialSchedule={requestedSchedule}
          />
        ) : null}
      </div>
    </section>
  )
}
