import { Link } from 'react-router-dom'
import { formatWorkspaceDate } from '../../workspace/model/formatters'
import { getWorkItemStatusLabel, getWorkItemStatusTone } from '../../workspace/model/labels'
import type { WorkItemRecord } from '../../workspace/model/types'
import { clampProgress } from '../model/dashboardView'
import styles from '../pages/DashboardPage.module.css'

function getStatusBadgeClassName(item: WorkItemRecord) {
  const tone = getWorkItemStatusTone(item.status)

  return [
    styles.statusBadge,
    tone === 'todo' ? styles.statusTodo : tone === 'inProgress' ? styles.statusInProgress : styles.statusDone,
  ].join(' ')
}

export function DashboardWorkItemCard({ item }: { item: WorkItemRecord }) {
  const progress = clampProgress(item.progress)

  return (
    <Link to={`/work-items/${item.workItemId}`} className={styles.taskCard}>
      <div className={styles.taskCardHeader}>
        <span className={styles.taskId}>{item.workItemId}</span>
        <span className={getStatusBadgeClassName(item)}>{getWorkItemStatusLabel(item.status)}</span>
      </div>
      <strong className={styles.taskTitle}>{item.title}</strong>
      <p className={styles.taskMeta}>
        담당 {item.ownerUserId} · 마감 {formatWorkspaceDate(item.dueDate)}
      </p>
      <div className={styles.progressBlock} aria-label={`진행률 ${progress}%`}>
        <div className={styles.progressTrack}>
          <span className={styles.progressValue} style={{ width: `${progress}%` }} />
        </div>
        <span>{progress}%</span>
      </div>
    </Link>
  )
}
