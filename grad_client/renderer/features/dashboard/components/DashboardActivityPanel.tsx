import { Link } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import { UserAvatar } from '../../../design-system/primitives/UserAvatar'
import { formatWorkspaceShortDate } from '../../workspace/model/formatters'
import { getWorkItemStatusLabel } from '../../workspace/model/labels'
import type { UserRecord, WorkItemRecord } from '../../workspace/model/types'
import { DashboardEmptyState } from './DashboardEmptyState'
import styles from '../pages/DashboardPage.module.css'

function getOwnerName(ownerUserId: string, users: UserRecord[]) {
  return users.find((user) => user.userId === ownerUserId)?.name ?? ownerUserId
}

export function DashboardActivityPanel({
  activityItems,
  users,
}: {
  activityItems: WorkItemRecord[]
  users: UserRecord[]
}) {
  return (
    <section className={[styles.panel, styles.activityPanel].join(' ')}>
      <div className={styles.sectionHeader}>
        <div>
          <h3 className={styles.sectionTitle}>최근 활동</h3>
        </div>
        <Link to="/org/manage" className={[styles.inlineLink, styles.boardViewLink].join(' ')}>
          전체 보기
          <Icon name="chevronRight" size={15} />
        </Link>
      </div>

      <div className={styles.activityList}>
        {activityItems.length > 0 ? (
          activityItems.map((item) => (
            <Link key={item.workItemId} to={`/work-items/${item.workItemId}`} className={styles.activityItem}>
              <UserAvatar
                name={getOwnerName(item.ownerUserId, users)}
                userId={item.ownerUserId}
                size="medium"
              />
              <div className={styles.activityCopy}>
                <p>
                  <strong>{getOwnerName(item.ownerUserId, users)}</strong> 님이 <strong>{item.title}</strong> 업무를{' '}
                  {getWorkItemStatusLabel(item.status)} 상태로 업데이트했습니다.
                </p>
              </div>
              <time className={styles.activityDate} dateTime={item.createdAt}>
                {formatWorkspaceShortDate(item.createdAt)}
              </time>
            </Link>
          ))
        ) : (
          <DashboardEmptyState>표시할 활동이 없습니다.</DashboardEmptyState>
        )}
      </div>
    </section>
  )
}
