import { Link } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import type { DashboardMetrics } from '../model/dashboardTypes'
import styles from './DashboardSummaryCards.module.css'

type DashboardSummaryCardsProps = {
  metrics: DashboardMetrics
}

export function DashboardSummaryCards({ metrics }: DashboardSummaryCardsProps) {
  return (
    <div className={styles.grid}>
      <article className={`${styles.card} ${styles.progressCard}`}>
        <span className={styles.iconBox} data-tone="info">
          <Icon name="clock" size={26} />
        </span>

        <div className={styles.primary}>
          <p className={styles.label} data-tone="info">진행 중인 업무</p>
          <div className={styles.valueRow}>
            <strong className={styles.value}>{metrics.activeCount}건</strong>
            <span className={styles.pill} data-tone="info">오늘 {metrics.todayWorkCount}건</span>
          </div>
        </div>

        <span className={styles.divider} aria-hidden="true" />

        <div className={styles.rate}>
          <p className={styles.label}>이번 주 마감 업무 완료율</p>
          <strong className={styles.rateValue}>{metrics.weekProgress}%</strong>
          <div className={styles.rateRow}>
            <span
              className={styles.progressTrack}
              role="progressbar"
              aria-valuenow={metrics.weekProgress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="이번 주 마감 업무 완료율"
            >
              <span className={styles.progressFill} style={{ width: `${metrics.weekProgress}%` }} />
            </span>
            <span className={styles.rateCaption}>
              {metrics.weekDoneCount}/{metrics.weekTotalCount} 완료
            </span>
          </div>
        </div>
      </article>

      <article className={`${styles.card} ${styles.dueCard}`}>
        <span className={styles.iconBox} data-tone="warning">
          <Icon name="alertTriangle" size={28} />
        </span>

        <div className={styles.primary}>
          <p className={styles.label} data-tone="danger">마감 임박</p>
          <div className={styles.valueRow}>
            <strong className={styles.dueValue}>오늘 {metrics.dueTodayCount}건</strong>
            <span className={styles.pill} data-tone="warning">3일 이내 {metrics.dueSoonCount}건</span>
          </div>
        </div>

        <span className={styles.divider} aria-hidden="true" />

        <div className={styles.nearest}>
          <p className={styles.label}>가장 가까운 마감</p>
          {metrics.nearestDue ? (
            <div className={styles.nearestItem}>
              <Icon name="fileText" size={18} className={styles.nearestIcon} />
              <div className={styles.nearestText}>
                <span className={styles.nearestTitle}>{metrics.nearestDue.title}</span>
                <span className={styles.nearestDate}>{metrics.nearestDue.dateLabel}</span>
              </div>
            </div>
          ) : (
            <p className={styles.nearestEmpty}>예정된 마감이 없습니다.</p>
          )}
        </div>

        {metrics.nearestDue ? (
          <Link
            className={`${styles.button} ${styles.dueButton}`}
            to={`/work-items/${metrics.nearestDue.workItemId}`}
          >
            마감 업무 보기
          </Link>
        ) : (
          <button type="button" className={`${styles.button} ${styles.dueButton}`} disabled>
            마감 업무 보기
          </button>
        )}
      </article>
    </div>
  )
}