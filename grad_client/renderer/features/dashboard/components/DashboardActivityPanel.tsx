import { Link } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import { UserAvatar } from '../../../design-system/primitives/UserAvatar'
import { formatWorkspaceShortDate } from '../../workspace/model/formatters'
import type { ActivityRecord, UserRecord, WorkItemRecord } from '../../workspace/model/types'
import { formatActivityMessage } from '../model/activityFormatter'
import { DashboardEmptyState } from './DashboardEmptyState'
import styles from '../pages/DashboardPage.module.css'

export function DashboardActivityPanel({
  activities,
  workItems = [],
  users = [],
}: {
  activities: ActivityRecord[]
  workItems?: WorkItemRecord[]
  users?: UserRecord[]
}) {
  const recentActivities = activities.slice(0, 5)
  const workItemsById = new Map(workItems.map((w) => [w.workItemId, w]))
  const usersById = new Map(users.map((u) => [u.userId, u]))

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
            const matchedWorkItemId = activity.targetName ? activity.targetName.replace(/^Comment on\s*/i, '').trim() : ''
            const linkTarget =
              activity.entityType.toUpperCase() === 'WORK_ITEM'
                ? `/work-items/${activity.entityId}`
                : activity.entityType.toUpperCase() === 'COMMENT' && matchedWorkItemId
                  ? `/work-items/${matchedWorkItemId}`
                  : '/org/manage'

            const actorName = activity.actorName || (activity.actorUserId && usersById.get(activity.actorUserId)?.name) || activity.actorUserId

            return (
              <Link key={activity.id} to={linkTarget} className={styles.activityItem}>
                <UserAvatar
                  name={actorName}
                  userId={activity.actorUserId}
                  size="medium"
                />
                <div className={styles.activityCopy}>
                  <p>
                    {formatActivityMessage(activity, {
                      actorName,
                      resolveUserName: (userId) => usersById.get(userId)?.name,
                      resolveWorkItemTitle: (workItemId) => workItemsById.get(workItemId)?.title,
                    })}
                  </p>
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

