import { Link } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import { formatWorkspaceShortDate } from '../../workspace/model/formatters'
import { getWorkItemStatusLabel, getWorkItemStatusTone } from '../../workspace/model/labels'
import type { WorkItemRecord } from '../../workspace/model/types'
import { WEEKDAY_LABELS, type DashboardCalendar } from '../model/dashboardView'
import styles from '../pages/DashboardPage.module.css'

type DashboardCalendarPanelProps = {
  calendar: DashboardCalendar
  onMonthChange: (offset: number) => void
}

function getStatusBadgeClassName(item: WorkItemRecord) {
  const tone = getWorkItemStatusTone(item.status)

  return [
    styles.calendarPreviewStatus,
    tone === 'todo'
      ? styles.statusTodo
      : tone === 'inProgress'
        ? styles.statusInProgress
        : styles.statusDone,
  ].join(' ')
}

export function DashboardCalendarPanel({ calendar, onMonthChange }: DashboardCalendarPanelProps) {
  const previewItems = calendar.dueItems.slice(0, 3)

  return (
    <section className={[styles.panel, styles.calendarPanel].join(' ')}>
      <div className={styles.sectionHeader}>
        <div className={styles.calendarHeaderContent}>
          <h3 className={styles.sectionTitle}>캘린더</h3>
          <div className={styles.calendarMonthRow}>
            <span className={styles.monthLabel}>{calendar.monthLabel}</span>
            <div className={styles.calendarMonthControls} aria-label="캘린더 월 이동">
              <button type="button" className={styles.calendarMonthButton} onClick={() => onMonthChange(-1)}>
                <Icon name="chevronLeft" size={17} />
                <span className={styles.srOnly}>이전 달</span>
              </button>
              <button type="button" className={styles.calendarMonthButton} onClick={() => onMonthChange(1)}>
                <Icon name="chevronRight" size={17} />
                <span className={styles.srOnly}>다음 달</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.weekdayGrid} aria-hidden="true">
        {WEEKDAY_LABELS.map((label, index) => (
          <span
            key={label}
            className={index === 0 ? styles.weekdaySunday : index === 6 ? styles.weekdaySaturday : undefined}
          >
            {label}
          </span>
        ))}
      </div>
      <div className={styles.calendarGrid}>
        {calendar.cells.map((cell, index) => {
          const weekdayIndex = index % 7

          return (
            <span
              key={cell.key}
              className={[
                styles.calendarDay,
                weekdayIndex === 0 ? styles.calendarDaySunday : '',
                weekdayIndex === 6 ? styles.calendarDaySaturday : '',
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
          )
        })}
      </div>

      <div className={styles.calendarPreview} aria-label="이번 달 업무 미리보기">
        {previewItems.length > 0 ? (
          <div className={styles.calendarPreviewList}>
            {previewItems.map((item) => (
              <Link key={item.workItemId} to={`/work-items/${item.workItemId}`} className={styles.calendarPreviewItem}>
                <time dateTime={item.dueDate}>{formatWorkspaceShortDate(item.dueDate)}</time>
                <span>{item.title}</span>
                <em className={getStatusBadgeClassName(item)}>{getWorkItemStatusLabel(item.status)}</em>
              </Link>
            ))}
          </div>
        ) : (
          <p className={styles.calendarPreviewEmpty}>이번 달에 마감해야할 일이 없습니다.</p>
        )}
      </div>
    </section>
  )
}
