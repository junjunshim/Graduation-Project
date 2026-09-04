import { Link } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import { UserAvatar } from '../../../design-system/primitives/UserAvatar'
import { formatWorkspaceShortDate } from '../../workspace/model/formatters'
import type { ActivityRecord } from '../../workspace/model/types'
import { formatActivityMessage } from '../model/activityFormatter'
import { DashboardEmptyState } from './DashboardEmptyState'
import styles from '../pages/DashboardPage.module.css'

export function DashboardActivityPanel({
  activities,
}: {
  activities: ActivityRecord[]
}) {
  const recentActivities = activities.slice(0, 5)

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
        {recentActivities.length > 0 ? (
          recentActivities.map((activity) => {
            const linkTarget =
              activity.entityType.toUpperCase() === 'WORK_ITEM'
                ? `/work-items/${activity.entityId}`
                : '/org/manage'

            return (
              <Link key={activity.id} to={linkTarget} className={styles.activityItem}>
                <UserAvatar
                  name={activity.actorName || activity.actorUserId}
                  userId={activity.actorUserId}
                  size="medium"
                />
                <div className={styles.activityCopy}>
                  <p>{formatActivityMessage(activity)}</p>
                </div>
                <time className={styles.activityDate} dateTime={activity.createdAt}>
                  {formatWorkspaceShortDate(activity.createdAt)}
                </time>
              </Link>
            )
          })
        ) : (
          <DashboardEmptyState
            icon="clock"
            title="최근 활동 내역이 없습니다"
          >
            조직 내 새로운 업데이트와 변경 사항이 이곳에 기록됩니다.
          </DashboardEmptyState>
        )}
      </div>
    </section>
  )
}

