import type { CSSProperties } from 'react'
import { Icon } from '../../../design-system/primitives/Icon'
import { WEEKDAY_LABELS, type DashboardCalendar } from '../model/dashboardView'
import styles from '../pages/DashboardPage.module.css'

type DashboardCalendarPanelProps = {
  calendar: DashboardCalendar
  previewHeight?: number
  onMonthChange: (offset: number) => void
}

export function DashboardCalendarPanel({ calendar, previewHeight, onMonthChange }: DashboardCalendarPanelProps) {
  const panelStyle = previewHeight
    ? ({ '--dashboard-preview-panel-height': `${previewHeight}px` } as CSSProperties)
    : undefined

  return (
    <section className={[styles.panel, styles.calendarPanel].join(' ')} style={panelStyle}>
      <div className={styles.sectionHeader}>
        <div className={styles.calendarHeaderContent}>
          <h3 className={styles.sectionTitle}>캘린더</h3>
          <div className={styles.calendarMonthRow}>
            <span className={styles.monthLabel}>{calendar.monthLabel}</span>
        <div className={styles.calendarMonthControls} aria-label="캘린더 월 이동">
          <button type="button" className={styles.calendarMonthButton} onClick={() => onMonthChange(-1)}>
            <Icon name="chevronUp" size={18} />
            <span className={styles.srOnly}>이전 달</span>
          </button>
          <button type="button" className={styles.calendarMonthButton} onClick={() => onMonthChange(1)}>
            <Icon name="chevronDown" size={18} />
            <span className={styles.srOnly}>다음 달</span>
          </button>
        </div>
          </div>
        </div>
      </div>

      <div className={styles.weekdayGrid} aria-hidden="true">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className={styles.calendarGrid}>
        {calendar.cells.map((cell) => (
          <span
            key={cell.key}
            className={[
              styles.calendarDay,
              !cell.isCurrentMonth ? styles.calendarDayMuted : '',
              cell.items.length > 0 ? styles.calendarDayActive : '',
              cell.isToday ? styles.calendarToday : '',
            ]
              .filter(Boolean)
              .join(' ')}
            title={cell.items.map((item) => item.title).join(', ')}
          >
            <span>{cell.day}</span>
            {cell.items.length > 0 ? <strong>{cell.items.length}</strong> : null}
          </span>
        ))}
      </div>
    </section>
  )
}
