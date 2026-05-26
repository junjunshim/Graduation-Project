import { Link } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import { formatWorkspaceShortDate } from '../../workspace/model/formatters'
import { getWorkItemStatusLabel } from '../../workspace/model/labels'
import type { WorkItemRecord } from '../../workspace/model/types'
import { DashboardEmptyState } from './DashboardEmptyState'
import styles from '../pages/DashboardPage.module.css'

export function DashboardActivityPanel({ activityItems }: { activityItems: WorkItemRecord[] }) {
  return (
    <section className={[styles.panel, styles.activityPanel].join(' ')}>
      <div className={styles.sectionHeader}>
        <div>
          <h3 className={styles.sectionTitle}>최근 활동</h3>
        </div>
        <Link to="/org/manage" className={styles.panelViewAllLink}>
          전체 보기
          <Icon name="arrowRight" size={15} />
        </Link>
      </div>

      <div className={styles.activityList}>
        {activityItems.length > 0 ? (
          activityItems.map((item) => (
            <Link key={item.workItemId} to={`/work-items/${item.workItemId}`} className={styles.activityItem}>
              <span className={styles.activityAvatar}>
                <Icon name="user" size={15} />
              </span>
              <div className={styles.activityCopy}>
                <p>
                  <strong>{item.ownerUserId}</strong> 님이 <strong>{item.title}</strong> 업무를{' '}
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
