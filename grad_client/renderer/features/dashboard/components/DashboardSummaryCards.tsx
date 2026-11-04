import { Icon } from '../../../design-system/primitives/Icon'
import type { DashboardMetrics } from '../model/dashboardTypes'
import styles from './DashboardSummaryCards.module.css'

type DashboardSummaryCardsProps = {
  metrics: DashboardMetrics
  onSelectOverdueFilter?: () => void
}

function SegmentBar({
  total,
  filled,
  tone = 'brand',
  ariaLabel,
}: {
  total: number
  filled: number
  tone?: 'brand' | 'success' | 'warning'
  ariaLabel: string
}) {
  const safeFilled = Math.max(0, Math.min(total, filled))

  return (
    <div
      className={styles.segmentTrack}
      data-size={total === 5 ? 'short' : 'long'}
      data-tone={tone}
      role="progressbar"
      aria-valuenow={safeFilled}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-label={ariaLabel}
    >
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          className={styles.segmentBlock}
          data-filled={index < safeFilled ? 'true' : undefined}
        />
      ))}
    </div>
  )
}

export function DashboardSummaryCards({
  metrics,
  onSelectOverdueFilter,
}: DashboardSummaryCardsProps) {
  const activeFilled =
    metrics.activeCount > 0
      ? Math.max(
          metrics.todayWorkCount > 0 ? 1 : 0,
          Math.round((metrics.todayWorkCount / metrics.activeCount) * 12),
        )
      : 0

  const progressFilled = Math.round((metrics.weekProgress / 100) * 12)

  const dueSoonFilled =
    metrics.dueSoonCount > 0
      ? Math.min(
          5,
          Math.max(
            metrics.dueTodayCount > 0 ? 1 : 0,
            Math.round((metrics.dueTodayCount / metrics.dueSoonCount) * 5),
          ),
        )
      : 0

  return (
    <div className={styles.grid}>
      {/* 카드 1: 진행 중인 업무 */}
      <article className={`${styles.card} ${styles.accentCard}`}>
        <div className={styles.cardHeader}>
          <span className={styles.iconCircle} data-tone="brand" aria-hidden="true">
            <Icon name="folder" size={20} />
          </span>
          <div className={styles.titleGroup}>
            <h3 className={styles.cardTitle}>진행 중인 업무</h3>
            <p className={styles.cardSubtitle}>진행 현황</p>
          </div>
        </div>

        <strong className={styles.mainValue}>{metrics.activeCount}건</strong>

        <div className={styles.cardFooter}>
          <p className={styles.caption}>
            오늘 진행 {metrics.todayWorkCount} / {metrics.activeCount}건
          </p>
          <SegmentBar
            total={12}
            filled={activeFilled}
            tone="brand"
            ariaLabel={`오늘 진행 ${metrics.todayWorkCount}/${metrics.activeCount}건`}
          />
        </div>
      </article>

      {/* 카드 2: 이번 주 완료율 */}
      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <span className={styles.iconCircle} data-tone="success" aria-hidden="true">
            <Icon name="checkCircle" size={20} />
          </span>
          <div className={styles.titleGroup}>
            <h3 className={styles.cardTitle}>이번 주 완료율</h3>
            <p className={styles.cardSubtitle}>마감 업무 기준</p>
          </div>
        </div>

        <strong className={styles.mainValue}>{metrics.weekProgress}%</strong>

        <div className={styles.cardFooter}>
          <p className={styles.caption}>
            {metrics.weekDoneCount} / {metrics.weekTotalCount}건 완료
          </p>
          <SegmentBar
            total={12}
            filled={progressFilled}
            tone="success"
            ariaLabel={`이번 주 완료율 ${metrics.weekProgress}%`}
          />
        </div>
      </article>

      {/* 카드 3: 마감 임박 */}
      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <span className={styles.iconCircle} data-tone="warning" aria-hidden="true">
            <Icon name="clock" size={20} />
          </span>
          <div className={styles.titleGroup}>
            <h3 className={styles.cardTitle}>마감 임박</h3>
            <p className={styles.cardSubtitle}>놓치지 않도록 확인하세요</p>
          </div>
        </div>

        <strong className={styles.mainValue}>오늘 {metrics.dueTodayCount}건</strong>

        <div className={styles.cardFooter}>
          <p className={styles.caption}>3일 이내 {metrics.dueSoonCount}건</p>
          <SegmentBar
            total={5}
            filled={dueSoonFilled}
            tone="warning"
            ariaLabel={`마감 임박 오늘 ${metrics.dueTodayCount}건 / 3일 이내 ${metrics.dueSoonCount}건`}
          />
        </div>
      </article>

      {/* 카드 4: 지연된 업무 */}
      <article className={styles.card}>
        <div className={styles.cardHeader}>
          <span className={styles.iconCircle} data-tone="danger" aria-hidden="true">
            <Icon name="alertTriangle" size={20} />
          </span>
          <div className={styles.titleGroup}>
            <h3 className={styles.cardTitle}>지연된 업무</h3>
            <p className={styles.cardSubtitle}>일정 확인이 필요해요</p>
          </div>
        </div>

        <strong className={styles.mainValue}>{metrics.overdueCount}건</strong>

        <div className={styles.overdueFooter}>
          <button
            type="button"
            className={styles.actionPill}
            onClick={onSelectOverdueFilter}
          >
            확인 필요
          </button>
          <span className={styles.caption}>마감 미정 {metrics.noDueDateCount}건</span>
        </div>
      </article>
    </div>
  )
}