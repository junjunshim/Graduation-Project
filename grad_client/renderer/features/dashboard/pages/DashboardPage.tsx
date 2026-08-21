import { useCallback, useState } from 'react'
import { getCurrentUser } from '../../auth/api'
import { getOrgSnapshot } from '../../workspace/data/orgService'
import { getWorkspaceOverview } from '../../workspace/queries/workspaceOverview'
import { DashboardActivityPanel } from '../components/DashboardActivityPanel'
import { DashboardBoard } from '../components/DashboardBoard'
import { DashboardCalendarPanel } from '../components/DashboardCalendarPanel'
import { DashboardDocumentsPanel } from '../components/DashboardDocumentsPanel'
import { DashboardKpiGrid } from '../components/DashboardKpiGrid'
import { DashboardOnboarding } from '../components/DashboardOnboarding'
import {
  buildDashboardCalendar,
  getDashboardMetrics,
} from '../model/dashboardView'
import styles from './DashboardPage.module.css'

export function DashboardPage() {
  const snapshot = getOrgSnapshot()
  const currentUser = getCurrentUser(snapshot)
  const [calendarMonthOffset, setCalendarMonthOffset] = useState(0)
  const handleCalendarMonthChange = useCallback((offset: number) => {
    setCalendarMonthOffset((currentOffset) => currentOffset + offset)
  }, [])

  if (!currentUser) {
    return null
  }

  const overview = getWorkspaceOverview(currentUser.userId, snapshot)
  const users = snapshot.users
  const activityItems = [...overview.visibleWorkItems]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 5)
  const calendar = buildDashboardCalendar(overview.visibleWorkItems, calendarMonthOffset)
  const metrics = getDashboardMetrics(overview)

  if (overview.summary.orgNodeCount === 0) {
    return <DashboardOnboarding overview={overview} />
  }

  return (
    <section className={styles.page}>
      <DashboardKpiGrid metrics={metrics} />

      <div className={styles.dashboardGrid}>
        <DashboardBoard workItems={overview.visibleWorkItems} users={users} />
        <DashboardCalendarPanel
          calendar={calendar}
          onMonthChange={handleCalendarMonthChange}
        />
        <DashboardDocumentsPanel recentDocuments={overview.recentWorkItems} users={users} />
        <DashboardActivityPanel activityItems={activityItems} users={users} />
      </div>

    </section>
  )
}
