import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react'
import { Icon } from '../../../design-system/primitives/Icon'
import { useWorkItemContextMenu } from '../../workspace/components/useWorkItemContextMenu'
import type { DashboardTaskRow, DashboardWeekBoard } from '../model/dashboardTypes'
import styles from './DashboardWorkSchedulePanel.module.css'

type DashboardWorkSchedulePanelProps = {
  board: DashboardWeekBoard
  /** 스크롤 기준이 되는 날짜 (보고 있는 주에 오늘이 있으면 오늘) */
  focusDateKey: string
  weekLabel: string
  onShiftWeek: (direction: number) => void
  onGoToday: () => void
}

type TaskRowProps = {
  row: DashboardTaskRow
  variant?: 'ongoing'
  onContextMenu: (event: MouseEvent, workItemId: string) => void
}

const EMPTY_WEEK_MESSAGE = '이번 주에 표시할 업무가 없습니다.'
const EMPTY_DAY_MESSAGE = '일정 없음'

function TaskRow({ row, variant, onContextMenu }: TaskRowProps) {
  return (
    <li
      className={styles.row}
      data-tone={row.accentTone}
      data-variant={variant}
      onContextMenu={(event) => onContextMenu(event, row.workItemId)}
    >
      <span className={styles.rowAccent} aria-hidden="true" />

      <div className={styles.rowMain}>
        <span className={styles.rowTitle}>{row.title}</span>
        <span className={styles.rowMeta}>
          <Icon name="calendar" size={15} className={styles.rowMetaIcon} />
          {row.startLabel ? <span>일자 {row.startLabel}</span> : null}
          {row.startLabel && row.dueLabel ? <span aria-hidden="true">·</span> : null}
          {row.dueLabel ? <span>마감 {row.dueLabel}</span> : <span>마감 미정</span>}
        </span>
      </div>

      {row.nodeTitle ? (
        <span className={styles.nodeChip} title={row.nodeTitle}>
          {row.nodeTitle}
        </span>
      ) : null}

      <span className={styles.statusPill}>{row.statusLabel}</span>
    </li>
  )
}

export function DashboardWorkSchedulePanel({
  board,
  focusDateKey,
  weekLabel,
  onShiftWeek,
  onGoToday,
}: DashboardWorkSchedulePanelProps) {
  // 업무를 우클릭하면 업무 메뉴(상세 이동/수정/하위 생성/즐겨찾기/삭제)를 띄운다.
  const { onWorkItemContextMenu, workItemContextMenu } = useWorkItemContextMenu()
  const bodyRef = useRef<HTMLDivElement>(null)
  const dayRefs = useRef(new Map<string, HTMLElement | null>())
  // 그날 걸쳐 있는 진행 중 업무는 접어 두고 필요할 때 펼쳐 본다.
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({})

  const toggleOngoing = useCallback((dateKey: string) => {
    setExpandedDays((previous) => ({ ...previous, [dateKey]: !previous[dateKey] }))
  }, [])

  const scrollToDay = useCallback((dateKey: string) => {
    const container = bodyRef.current
    const target = dayRefs.current.get(dateKey)

    if (!container || !target) {
      return
    }

    container.scrollTo({
      top: Math.max(0, target.offsetTop - container.offsetTop - 4),
      behavior: 'auto',
    })
  }, [])

  // 주가 바뀌면 기준 날짜(오늘 또는 이동한 날짜) 그룹이 바로 보이게 맞춘다.
  useEffect(() => {
    scrollToDay(focusDateKey)
  }, [focusDateKey, board, scrollToDay])

  const hasAnyRow =
    board.days.some((day) => day.events.length > 0 || day.ongoing.length > 0) ||
    board.overdue.length > 0 ||
    board.unscheduled.length > 0

  return (
    <section className={styles.panel} aria-label="업무 일정">
      <header className={styles.header}>
        <h2 className={styles.title}>
          업무 일정
          <span className={styles.titleDetail}>· {weekLabel}</span>
        </h2>

        <div className={styles.controls}>
          <button className={styles.todayButton} type="button" onClick={onGoToday}>
            오늘
          </button>

          <div className={styles.nav}>
            <button
              className={styles.navButton}
              type="button"
              aria-label="이전 주"
              onClick={() => onShiftWeek(-1)}
            >
              <Icon name="chevronLeft" size={18} />
            </button>
            <button
              className={styles.navButton}
              type="button"
              aria-label="다음 주"
              onClick={() => onShiftWeek(1)}
            >
              <Icon name="chevronRight" size={18} />
            </button>
          </div>
        </div>
      </header>

      <div className={styles.body} ref={bodyRef}>
        {hasAnyRow ? (
          <>
            {board.days.map((day) => {
              const dueCount = day.events.filter((row) => row.accentTone === 'due').length
              const startCount = day.events.length - dueCount

              return (
                <section
                  className={styles.day}
                  key={day.key}
                  data-today={day.isToday ? 'true' : undefined}
                  data-past={day.isPast ? 'true' : undefined}
                  ref={(element) => {
                    dayRefs.current.set(day.key, element)
                  }}
                >
                  <header className={styles.dayHeader}>
                    <span className={styles.dayWeekday}>{day.weekdayLabel}</span>
                    <span className={styles.dayDate}>{day.dayLabel}</span>
                    {day.isToday ? <span className={styles.todayBadge}>오늘</span> : null}

                    <span className={styles.dayCounts}>
                      {dueCount > 0 ? (
                        <span className={styles.dayCount} data-tone="due">마감 {dueCount}</span>
                      ) : null}
                      {startCount > 0 ? (
                        <span className={styles.dayCount} data-tone="start">시작 {startCount}</span>
                      ) : null}
                    </span>
                  </header>

                  {day.events.length === 0 && day.ongoing.length === 0 ? (
                    <p className={styles.dayEmpty}>{EMPTY_DAY_MESSAGE}</p>
                  ) : null}

                  {day.events.length > 0 ? (
                    <ul className={styles.list}>
                      {day.events.map((row) => (
                        <TaskRow
                          key={`event-${row.workItemId}`}
                          row={row}
                          onContextMenu={onWorkItemContextMenu}
                        />
                      ))}
                    </ul>
                  ) : null}

                  {day.ongoing.length > 0 ? (
                    <>
                      <button
                        className={styles.subToggle}
                        type="button"
                        aria-expanded={expandedDays[day.key] === true}
                        onClick={() => toggleOngoing(day.key)}
                      >
                        <Icon
                          name={expandedDays[day.key] ? 'chevronDown' : 'chevronRight'}
                          size={15}
                          className={styles.subToggleIcon}
                        />
                        <span>진행 중</span>
                        <span className={styles.subToggleCount}>{day.ongoing.length}건</span>
                      </button>

                      {expandedDays[day.key] ? (
                        <ul className={styles.list}>
                          {day.ongoing.map((row) => (
                            <TaskRow
                              key={`ongoing-${row.workItemId}`}
                              row={row}
                              variant="ongoing"
                              onContextMenu={onWorkItemContextMenu}
                            />
                          ))}
                        </ul>
                      ) : null}
                    </>
                  ) : null}
                </section>
              )
            })}

            {board.overdue.length > 0 ? (
              <section className={styles.section} data-kind="overdue">
                <header className={styles.sectionHeader}>
                  <Icon name="alertTriangle" size={16} className={styles.sectionIcon} />
                  <h3 className={styles.sectionTitle}>지연</h3>
                  <span className={styles.sectionCount}>{board.overdue.length}건</span>
                </header>
                <ul className={styles.list}>
                  {board.overdue.map((row) => (
                    <TaskRow
                      key={`overdue-${row.workItemId}`}
                      row={row}
                      onContextMenu={onWorkItemContextMenu}
                    />
                  ))}
                </ul>
              </section>
            ) : null}

            {board.unscheduled.length > 0 ? (
              <section className={styles.section} data-kind="unscheduled">
                <header className={styles.sectionHeader}>
                  <Icon name="calendar" size={16} className={styles.sectionIcon} />
                  <h3 className={styles.sectionTitle}>마감 미정</h3>
                  <span className={styles.sectionCount}>{board.unscheduled.length}건</span>
                </header>
                <ul className={styles.list}>
                  {board.unscheduled.map((row) => (
                    <TaskRow
                      key={`unscheduled-${row.workItemId}`}
                      row={row}
                      onContextMenu={onWorkItemContextMenu}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : (
          <p className={styles.empty}>{EMPTY_WEEK_MESSAGE}</p>
        )}
      </div>

      {workItemContextMenu}
    </section>
  )
}