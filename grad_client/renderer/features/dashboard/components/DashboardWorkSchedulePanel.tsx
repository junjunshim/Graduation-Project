import { Icon } from '../../../design-system/primitives/Icon'
import { DatePicker } from '../../../design-system/primitives/DatePicker'
import { useWorkItemContextMenu } from '../../workspace/components/useWorkItemContextMenu'
import type { DashboardCalendarDay, DashboardTaskRow } from '../model/dashboardTypes'
import styles from './DashboardWorkSchedulePanel.module.css'

type DashboardWorkSchedulePanelProps = {
  days: DashboardCalendarDay[]
  rows: DashboardTaskRow[]
  selectedDateKey: string
  selectedDateLabel: string
  minSelectableDateKey: string
  maxSelectableDateKey: string
  onSelectDate: (dateKey: string) => void
  onShiftDate: (direction: number) => void
  onGoToday: () => void
}

const EMPTY_MESSAGE = '선택한 날짜에 해당하는 업무가 없습니다.'

export function DashboardWorkSchedulePanel({
  days,
  rows,
  selectedDateKey,
  selectedDateLabel,
  minSelectableDateKey,
  maxSelectableDateKey,
  onSelectDate,
  onShiftDate,
  onGoToday,
}: DashboardWorkSchedulePanelProps) {
  // 업무를 우클릭하면 업무 메뉴(상세 이동/수정/하위 생성/즐겨찾기/삭제)를 띄운다.
  const { onWorkItemContextMenu, workItemContextMenu } = useWorkItemContextMenu()

  return (
    <section className={styles.panel} aria-label="업무 일정">
      <header className={styles.header}>
        <h2 className={styles.title}>
          업무 일정
          <span className={styles.titleDetail}>· {selectedDateLabel}</span>
        </h2>

        <div className={styles.controls}>
          <div className={styles.dateField}>
            <DatePicker
              label="업무 일정 날짜"
              value={selectedDateKey}
              onChange={onSelectDate}
              minDate={minSelectableDateKey}
              maxDate={maxSelectableDateKey}
              panelAlign="end"
            />
          </div>

          <button className={styles.todayButton} type="button" onClick={onGoToday}>
            오늘
          </button>

          <div className={styles.nav}>
            <button
              className={styles.navButton}
              type="button"
              aria-label="이전 날짜"
              onClick={() => onShiftDate(-1)}
            >
              <Icon name="chevronLeft" size={18} />
            </button>
            <button
              className={styles.navButton}
              type="button"
              aria-label="다음 날짜"
              onClick={() => onShiftDate(1)}
            >
              <Icon name="chevronRight" size={18} />
            </button>
          </div>
        </div>
      </header>

      <ol className={styles.days}>
        {days.map((day) => {
          const isSelected = selectedDateKey === day.key

          return (
            <li className={styles.day} key={day.key} data-today={day.isToday ? 'true' : undefined}>
              <span className={styles.dayWeekday}>{day.weekdayLabel}</span>
              <button
                className={styles.dayChip}
                type="button"
                data-selected={isSelected ? 'true' : undefined}
                aria-pressed={isSelected}
                disabled={!day.isSelectable}
                aria-label={`${day.weekdayLabel}요일 ${day.dayLabel}일 업무 보기`}
                onClick={() => onSelectDate(day.key)}
              >
                {day.dayLabel}
              </button>
              <span className={styles.dots} aria-hidden="true">
                {Array.from({ length: day.dotCount }, (_, index) => (
                  <span className={styles.dot} key={index} />
                ))}
              </span>
            </li>
          )
        })}
      </ol>

      <div className={styles.body}>
        {rows.length === 0 ? (
          <p className={styles.empty}>{EMPTY_MESSAGE}</p>
        ) : (
          <ul className={styles.list}>
            {rows.map((row) => (
              <li
                className={styles.row}
                key={row.workItemId}
                data-tone={row.accentTone}
                onContextMenu={(event) => onWorkItemContextMenu(event, row.workItemId)}
              >
                <span className={styles.rowAccent} aria-hidden="true" />

                <div className={styles.rowMain}>
                  <span className={styles.rowTitle}>{row.title}</span>
                  <span className={styles.rowMeta}>
                    <Icon name="calendar" size={15} className={styles.rowMetaIcon} />
                    {row.startLabel ? <span>일자 {row.startLabel}</span> : null}
                    {row.startLabel && row.dueLabel ? <span aria-hidden="true">·</span> : null}
                    {row.dueLabel ? <span>마감 {row.dueLabel}</span> : null}
                  </span>
                </div>

                {row.nodeTitle ? (
                  <span className={styles.nodeChip} title={row.nodeTitle}>
                    {row.nodeTitle}
                  </span>
                ) : null}

                <span className={styles.statusPill}>{row.statusLabel}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {workItemContextMenu}
    </section>
  )
}
