import { useState } from 'react'
import { getCurrentUser } from '../../auth/api'
import { getWorkspaceOverview } from '../../workspace/queries/workspaceOverview'
import { DashboardActivityPanel } from '../components/DashboardActivityPanel'
import { DashboardBoard } from '../components/DashboardBoard'
import { DashboardCalendarPanel } from '../components/DashboardCalendarPanel'
import { DashboardDocumentsPanel } from '../components/DashboardDocumentsPanel'
import { DashboardKpiGrid } from '../components/DashboardKpiGrid'
import { DashboardOnboarding } from '../components/DashboardOnboarding'
import { DashboardQuickDock } from '../components/DashboardQuickDock'
import { DashboardToolbar } from '../components/DashboardToolbar'
import {
  buildDashboardCalendar,
  getDashboardMetrics,
  getDueSoonOpenWorkItems,
  matchesWorkItemSearch,
} from '../model/dashboardView'
import styles from './DashboardPage.module.css'

export function DashboardPage() {
  const currentUser = getCurrentUser()
  const [searchQuery, setSearchQuery] = useState('')

  if (!currentUser) {
    return null
  }

  const overview = getWorkspaceOverview(currentUser.userId)
  const filteredWorkItems = overview.visibleWorkItems.filter((item) => matchesWorkItemSearch(item, searchQuery))
  const recentDocuments = overview.recentWorkItems.filter((item) => matchesWorkItemSearch(item, searchQuery))
  const activityItems = [...overview.visibleWorkItems]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .filter((item) => matchesWorkItemSearch(item, searchQuery))
    .slice(0, 5)
  const calendar = buildDashboardCalendar(overview.visibleWorkItems)
  const dueSoonOpenWorkItems = getDueSoonOpenWorkItems(overview)
  const metrics = getDashboardMetrics(overview)

  if (overview.summary.orgNodeCount === 0) {
    return <DashboardOnboarding overview={overview} />
  }

  return (
    <section className={styles.page}>
      <DashboardToolbar
        searchQuery={searchQuery}
        dueSoonOpenCount={dueSoonOpenWorkItems.length}
        currentUser={currentUser}
        onSearchQueryChange={setSearchQuery}
      />

      <DashboardKpiGrid metrics={metrics} />

      <div className={styles.dashboardGrid}>
        <DashboardBoard workItems={filteredWorkItems} />
        <DashboardCalendarPanel calendar={calendar} />
        <DashboardDocumentsPanel recentDocuments={recentDocuments} />
        <DashboardActivityPanel activityItems={activityItems} />
      </div>

      <DashboardQuickDock />
    </section>
  )
}
