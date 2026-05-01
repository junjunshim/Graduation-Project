import { Link } from 'react-router-dom'
import { formatWorkspaceDate } from '../../workspace/model/formatters'
import { WEEKDAY_LABELS, type DashboardCalendar } from '../model/dashboardView'
import { DashboardEmptyState } from './DashboardEmptyState'
import styles from '../pages/DashboardPage.module.css'

export function DashboardCalendarPanel({ calendar }: { calendar: DashboardCalendar }) {
  return (
    <section className={[styles.panel, styles.calendarPanel].join(' ')}>
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

      <div className={styles.calendarAgenda}>
        {calendar.dueItems.slice(0, 4).map((item) => (
          <Link key={item.workItemId} to={`/work-items/${item.workItemId}`} className={styles.agendaItem}>
            <span>{formatWorkspaceDate(item.dueDate)}</span>
            <strong>{item.title}</strong>
          </Link>
        ))}
        {calendar.dueItems.length === 0 ? <DashboardEmptyState>등록된 마감 일정이 없습니다.</DashboardEmptyState> : null}
      </div>
    </section>
  )
}
