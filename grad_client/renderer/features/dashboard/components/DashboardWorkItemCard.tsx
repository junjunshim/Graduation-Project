import { Link } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import { formatWorkspaceShortDate } from '../../workspace/model/formatters'
import { getWorkItemStatusLabel, getWorkItemStatusTone } from '../../workspace/model/labels'
import type { UserRecord, WorkItemRecord } from '../../workspace/model/types'
import { clampProgress } from '../model/dashboardView'
import styles from '../pages/DashboardPage.module.css'

function getStatusBadgeClassName(item: WorkItemRecord) {
  const tone = getWorkItemStatusTone(item.status)

  return [
    styles.statusBadge,
    tone === 'todo' ? styles.statusTodo : tone === 'inProgress' ? styles.statusInProgress : styles.statusDone,
  ].join(' ')
}

function getOwnerName(ownerUserId: string, users: UserRecord[]) {
  return users.find((user) => user.userId === ownerUserId)?.name ?? ownerUserId
}

export function DashboardWorkItemCard({ item, users }: { item: WorkItemRecord; users: UserRecord[] }) {
  const progress = clampProgress(item.progress)
  const ownerName = getOwnerName(item.ownerUserId, users)

  return (
    <Link to={`/work-items/${item.workItemId}`} className={styles.taskCard}>
      <div className={styles.taskCardHeader}>
        <span className={styles.taskId}>{item.workItemId}</span>
        <span className={getStatusBadgeClassName(item)}>{getWorkItemStatusLabel(item.status)}</span>
      </div>
      <strong className={styles.taskTitle}>{item.title}</strong>
      <div className={styles.taskMeta}>
        <span className={styles.taskOwner}>
          <span className={styles.taskOwnerIcon}>
            <Icon name="user" size={14} />
          </span>
          <span className={styles.taskOwnerName}>{ownerName}</span>
        </span>
        <time className={styles.taskDueDate} dateTime={item.dueDate}>
          {formatWorkspaceShortDate(item.dueDate)}
        </time>
      </div>
      <div className={styles.progressBlock} aria-label={`progress ${progress}%`}>
        <div className={styles.progressTrack}>
          <span className={styles.progressValue} style={{ width: `${progress}%` }} />
        </div>
        <span>{progress}%</span>
      </div>
    </Link>
  )
}
