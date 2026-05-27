import { useCallback, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import { getCurrentUser } from '../../auth/api'
import { getOrgSnapshot } from '../../workspace/data/orgService'
import { getWorkspaceOverview } from '../../workspace/queries/workspaceOverview'
import { DashboardActivityPanel } from '../components/DashboardActivityPanel'
import { DashboardBoard } from '../components/DashboardBoard'
import { DashboardCalendarPanel } from '../components/DashboardCalendarPanel'
import { DashboardDocumentsPanel } from '../components/DashboardDocumentsPanel'
import { DashboardKpiGrid } from '../components/DashboardKpiGrid'
import { DashboardOnboarding } from '../components/DashboardOnboarding'
import { DashboardQuickDock } from '../components/DashboardQuickDock'
import {
  buildDashboardCalendar,
  getDashboardMetrics,
} from '../model/dashboardView'
import styles from './DashboardPage.module.css'

export function DashboardPage() {
  const currentUser = getCurrentUser()
  const [boardPreviewHeight, setBoardPreviewHeight] = useState<number>()
  const handleBoardPreviewHeightChange = useCallback((height: number) => {
    setBoardPreviewHeight((currentHeight) => (currentHeight === height ? currentHeight : height))
  }, [])

  if (!currentUser) {
    return null
  }

  const overview = getWorkspaceOverview(currentUser.userId)
  const users = getOrgSnapshot().users
  const activityItems = [...overview.visibleWorkItems]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 5)
  const calendar = buildDashboardCalendar(overview.visibleWorkItems)
  const metrics = getDashboardMetrics(overview)

  if (overview.summary.orgNodeCount === 0) {
    return <DashboardOnboarding overview={overview} />
  }

  return (
    <section className={styles.page}>
      {/*
      <DashboardToolbar
        searchQuery={searchQuery}
        dueSoonOpenCount={dueSoonOpenWorkItems.length}
        currentUser={currentUser}
        onSearchQueryChange={setSearchQuery}
      />
      */}
      <div className={styles.kpiTopBar}>
        <Link to="/work-items/new" className={styles.newTaskButton}>
          <Icon name="plus" size={18} />
          새 작업
        </Link>
      </div>
      <DashboardKpiGrid metrics={metrics} />

      <div className={styles.dashboardGrid}>
        <DashboardBoard
          workItems={overview.visibleWorkItems}
          onPreviewHeightChange={handleBoardPreviewHeightChange}
        />
        <DashboardCalendarPanel calendar={calendar} previewHeight={boardPreviewHeight} />
        <DashboardDocumentsPanel recentDocuments={overview.recentWorkItems} users={users} />
        <DashboardActivityPanel activityItems={activityItems} users={users} />
      </div>

      <DashboardQuickDock />
    </section>
  )
}
