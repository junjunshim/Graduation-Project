import { Icon } from '../../../design-system/primitives/Icon'
import type { DashboardSchedule } from '../model/dashboardTypes'
import styles from './DashboardSchedulePanel.module.css'

type DashboardSchedulePanelProps = {
  schedules: DashboardSchedule[]
  onOpenSchedule: (ruleId: number) => void
  onViewCalendar: () => void
}

const EMPTY_MESSAGE = '예정된 정기 일정이 없습니다.'

export function DashboardSchedulePanel({
  schedules,
  onOpenSchedule,
  onViewCalendar,
}: DashboardSchedulePanelProps) {
  return (
    <section className={styles.panel} aria-label="다가오는 일정">
      <header className={styles.header}>
        <h2 className={styles.title}>다가오는 일정</h2>
        <button type="button" className={styles.viewAllButton} onClick={onViewCalendar}>
          전체 보기
        </button>
      </header>

      <div className={styles.body}>
        {schedules.length === 0 ? (
          <p className={styles.empty}>{EMPTY_MESSAGE}</p>
        ) : (
          <ul className={styles.list}>
            {schedules.map((schedule) => (
              <li className={styles.item} key={schedule.ruleId}>
                <div
                  className={styles.dateAvatarWrap}
                  data-today={schedule.isToday ? 'true' : undefined}
                >
                  <div className={styles.dateAvatar}>
                    <span className={styles.monthLabel}>{schedule.monthShort}</span>
                    <strong className={styles.dayNumber}>{schedule.dayNumber}</strong>
                  </div>
                  <span className={styles.weekdaySubBadge}>
                    {schedule.isToday ? '오늘' : schedule.weekdayShort}
                  </span>
                </div>

                <div className={styles.content}>
                  <h3 className={styles.itemTitle}>{schedule.title}</h3>
                  <p className={styles.timeRange}>{schedule.timeRangeLabel}</p>
                  <p className={styles.nodeMeta}>
                    <Icon name="building" size={14} className={styles.nodeMetaIcon} />
                    <span>{schedule.nodeTitle ?? '공통 워크스페이스'}</span>
                  </p>
                </div>

                <button
                  type="button"
                  className={styles.openButton}
                  aria-label={`${schedule.title} 일정 상세 보기`}
                  onClick={() => onOpenSchedule(schedule.ruleId)}
                >
                  <span aria-hidden="true">↗</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <button type="button" className={styles.calendarWideButton} onClick={onViewCalendar}>
        <Icon name="calendar" size={16} />
        <span>캘린더에서 전체 일정 보기</span>
        <span className={styles.arrowDiag} aria-hidden="true">↗</span>
      </button>
    </section>
  )
}