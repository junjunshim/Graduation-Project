import { Link } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import { UserAvatar } from '../../../design-system/primitives/UserAvatar'
import { formatWorkspaceShortDate } from '../../workspace/model/formatters'
import type { UserRecord, WorkItemRecord } from '../../workspace/model/types'
import styles from '../pages/DashboardPage.module.css'

function getOwnerName(ownerUserId: string, users: UserRecord[]) {
  return users.find((user) => user.userId === ownerUserId)?.name ?? ownerUserId
}

export function DashboardWorkItemCard({ item, users }: { item: WorkItemRecord; users: UserRecord[] }) {
  const ownerName = getOwnerName(item.ownerUserId, users)

  return (
    <Link to={`/work-items/${item.workItemId}`} className={styles.taskCard}>
      <div className={styles.taskCardHeader}>
        <strong className={styles.taskTitle}>{item.title}</strong>
        {item.status === 'done' ? (
          <Icon name="checkCircle" size={16} className={styles.taskDoneIcon} />
        ) : null}
      </div>
      <div className={styles.taskMeta}>
        <span className={styles.taskOwner}>
          <UserAvatar name={ownerName} userId={item.ownerUserId} />
          <span className={styles.taskOwnerName}>{ownerName}</span>
        </span>
        <time className={styles.taskDueDate} dateTime={item.dueDate}>
          {formatWorkspaceShortDate(item.dueDate)}
        </time>
      </div>
    </Link>
  )
}
