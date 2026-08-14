import { Link, useSearchParams } from 'react-router-dom'
import { getCurrentUser } from '../../auth/api'
import { WorkspaceTasksTab } from '../../workspace/components/WorkspaceTasksTab'
import { getOrgSnapshot } from '../../workspace/data/orgService'
import { getWorkspaceOverview } from '../../workspace/queries/workspaceOverview'
import { WorkItemCreatePage } from './WorkItemCreatePage'
import styles from './WorkItemsPage.module.css'

type WorkItemsView = 'list' | 'create'

type WorkItemsTab = {
  label: string
  to: string
  view: WorkItemsView
}

const workItemsTabs: WorkItemsTab[] = [
  { label: '목록', to: '/work-items', view: 'list' },
  { label: '생성', to: '/work-items?view=create', view: 'create' },
]

export function WorkItemsPage() {
  const [searchParams] = useSearchParams()
  const requestedView = searchParams.get('view')
  const activeView: WorkItemsView = requestedView === 'create' ? 'create' : 'list'
  const snapshot = getOrgSnapshot()
  const currentUser = getCurrentUser(snapshot)
  const overview = currentUser ? getWorkspaceOverview(currentUser.userId, snapshot) : null
  const visibleOwnerIds = new Set(overview?.visibleWorkItems.map((item) => item.ownerUserId) ?? [])
  const visibleMembers = snapshot.users.filter((user) => visibleOwnerIds.has(user.userId))

  return (
    <section className={styles.page}>
      <div className={styles.navigationBar}>
        <nav className={styles.tabs} aria-label="업무 보기">
          {workItemsTabs.map((tab) => {
            const isActive = tab.view === activeView

            return (
              <Link
                key={tab.view}
                to={tab.to}
                className={[styles.tabLink, isActive ? styles.tabLinkActive : '']
                  .filter(Boolean)
                  .join(' ')}
                aria-current={isActive ? 'page' : undefined}
              >
                {tab.label}
              </Link>
            )
          })}
        </nav>
      </div>

      <div className={styles.tabContent}>
        {activeView === 'create' ? (
          <WorkItemCreatePage embedded />
        ) : overview ? (
          <WorkspaceTasksTab
            workItems={overview.visibleWorkItems}
            members={visibleMembers}
            tableLabel="접근 가능한 전체 업무 목록"
            createHref="/work-items?view=create"
            filterLayout="toolbar"
            showHeading={false}
          />
        ) : null}
      </div>
    </section>
  )
}
