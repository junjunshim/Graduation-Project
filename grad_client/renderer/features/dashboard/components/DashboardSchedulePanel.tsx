import { Icon } from '../../../design-system/primitives/Icon'
import { useTheme } from '../../../design-system/theme/ThemeContext'
import { getScheduleIllustration } from '../model/dashboardAssets'
import type { DashboardSchedule } from '../model/dashboardTypes'
import styles from './DashboardSchedulePanel.module.css'

type DashboardSchedulePanelProps = {
  schedules: DashboardSchedule[]
  onOpenSchedule: (ruleId: number) => void
}

const EMPTY_MESSAGE = '예정된 정기 일정이 없습니다.'

export function DashboardSchedulePanel({ schedules, onOpenSchedule }: DashboardSchedulePanelProps) {
  const { themeMode } = useTheme()

  return (
    <section className={styles.panel} aria-label="다가오는 일정">
      <h2 className={styles.title}>다가오는 일정</h2>

      <div className={styles.body}>
        {schedules.length === 0 ? (
          <p className={styles.empty}>{EMPTY_MESSAGE}</p>
        ) : (
          schedules.map((schedule) => {
            const illustration = getScheduleIllustration(schedule.category, themeMode)

            return (
              <article className={styles.card} key={schedule.ruleId}>
                <div className={styles.thumbnailBox}>
                  {illustration ? (
                    <img className={styles.thumbnail} src={illustration} alt="" loading="lazy" />
                  ) : (
                    <span className={styles.thumbnailFallback} aria-hidden="true">
                      <Icon name="calendar" size={28} />
                    </span>
                  )}
                </div>

                <div className={styles.content}>
                  <span className={styles.badge}>{schedule.badgeLabel}</span>
                  <h3 className={styles.cardTitle}>{schedule.title}</h3>

                  <p className={styles.meta}>
                    <Icon name="calendar" size={15} className={styles.metaIcon} />
                    <span>{schedule.dateLabel}</span>
                  </p>
                  <p className={styles.meta}>
                    <Icon name="repeat" size={15} className={styles.metaIcon} />
                    <span>{schedule.repeatLabel}</span>
                  </p>
                  {schedule.description ? (
                    <p className={styles.meta}>
                      <Icon name="fileText" size={15} className={styles.metaIcon} />
                      <span className={styles.metaText}>{schedule.description}</span>
                    </p>
                  ) : null}

                  <button
                    className={styles.link}
                    type="button"
                    onClick={() => onOpenSchedule(schedule.ruleId)}
                  >
                    일정 보기
                  </button>
                </div>
              </article>
            )
          })
        )}
      </div>
    </section>
  )
}