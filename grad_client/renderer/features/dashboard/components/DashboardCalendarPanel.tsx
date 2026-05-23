import type { CSSProperties } from 'react'
import { WEEKDAY_LABELS, type DashboardCalendar } from '../model/dashboardView'
import styles from '../pages/DashboardPage.module.css'

type DashboardCalendarPanelProps = {
  calendar: DashboardCalendar
  previewHeight?: number
}

export function DashboardCalendarPanel({ calendar, previewHeight }: DashboardCalendarPanelProps) {
  const panelStyle = previewHeight
    ? ({ '--dashboard-preview-panel-height': `${previewHeight}px` } as CSSProperties)
    : undefined

  return (
    <section className={[styles.panel, styles.calendarPanel].join(' ')} style={panelStyle}>
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.sectionEyebrow}>Calendar</p>
          <h3 className={styles.sectionTitle}>캘린더</h3>
        </div>
        <span className={styles.monthLabel}>{calendar.monthLabel}</span>
      </div>

      <div className={styles.weekdayGrid} aria-hidden="true">
        {WEEKDAY_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className={styles.calendarGrid}>
        {calendar.cells.map((cell) =>
          cell.type === 'empty' ? (
            <span key={cell.key} className={styles.calendarEmpty} />
          ) : (
            <span
              key={cell.key}
              className={[
                styles.calendarDay,
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
          ),
        )}
      </div>
    </section>
  )
}
