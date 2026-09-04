import { useCallback, useState } from 'react'
import { getCurrentUser } from '../../auth/api'
import { getOrgSnapshot } from '../../workspace/data/orgService'
import { getWorkspaceOverview } from '../../workspace/queries/workspaceOverview'
import { DashboardActivityPanel } from '../components/DashboardActivityPanel'
import { DashboardBoard } from '../components/DashboardBoard'
import { DashboardCalendarPanel } from '../components/DashboardCalendarPanel'
import { DashboardDocumentsPanel } from '../components/DashboardDocumentsPanel'
import { DashboardKpiGrid } from '../components/DashboardKpiGrid'
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
  const recentFiles = snapshot.files ?? []
  const recentActivities = snapshot.activities ?? []
  const calendar = buildDashboardCalendar(overview.visibleWorkItems, calendarMonthOffset)
  const metrics = getDashboardMetrics(overview)

  return (
    <section className={styles.page}>
      <DashboardKpiGrid metrics={metrics} />

      <div className={styles.dashboardGrid}>
        <DashboardBoard workItems={overview.visibleWorkItems} users={users} />
        <DashboardCalendarPanel
          calendar={calendar}
          onMonthChange={handleCalendarMonthChange}
        />
        <DashboardDocumentsPanel files={recentFiles} />
        <DashboardActivityPanel
          activities={recentActivities}
          workItems={overview.visibleWorkItems}
          users={users}
        />
      </div>

    </section>
  )
}
