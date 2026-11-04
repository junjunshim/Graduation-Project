import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import { useWorkItemContextMenu } from '../../workspace/components/useWorkItemContextMenu'
import type { DashboardTableTaskRow, DashboardTaskFilter } from '../model/dashboardTypes'
import styles from './DashboardWorkSchedulePanel.module.css'

type DashboardWorkSchedulePanelProps = {
  rows: DashboardTableTaskRow[]
  weekLabel: string
  filter: DashboardTaskFilter
  weekRemainingCount: number
  onFilterChange: (filter: DashboardTaskFilter) => void
  onShiftWeek: (direction: number) => void
  onGoToday: () => void
  onViewAll: () => void
}

const FILTER_OPTIONS: ReadonlyArray<{ value: DashboardTaskFilter; label: string }> = [
  { value: 'all', label: '전체' },
  { value: 'in-progress', label: '진행 중' },
  { value: 'todo', label: '예정' },
  { value: 'done', label: '완료' },
  { value: 'overdue', label: '지연' },
  { value: 'unscheduled', label: '마감 미정' },
]

const EMPTY_TABLE_MESSAGE = '선택한 조건에 해당하는 업무가 없습니다.'

function resolveStatusPillVariant(
  row: DashboardTableTaskRow,
): 'in-progress' | 'todo' | 'done' | 'overdue' {
  if (row.isOverdue) {
    return 'overdue'
  }
  if (row.status === 'in-progress') {
    return 'in-progress'
  }
  if (row.status === 'done') {
    return 'done'
  }
  return 'todo'
}

export function DashboardWorkSchedulePanel({
  rows,
  weekLabel,
  filter,
  weekRemainingCount,
  onFilterChange,
  onShiftWeek,
  onGoToday,
  onViewAll,
}: DashboardWorkSchedulePanelProps) {
  const navigate = useNavigate()
  const { onWorkItemContextMenu, workItemContextMenu } = useWorkItemContextMenu()
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const filterWrapRef = useRef<HTMLDivElement>(null)

  const selectedFilterLabel =
    FILTER_OPTIONS.find((opt) => opt.value === filter)?.label ?? '필터'

  useEffect(() => {
    if (!isFilterOpen) return undefined

    function handleOutsideClick(event: MouseEvent) {
      if (!filterWrapRef.current?.contains(event.target as Node)) {
        setIsFilterOpen(false)
      }
    }

    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [isFilterOpen])

  return (
    <section className={styles.panel} aria-label="업무 일정">
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h2 className={styles.title}>업무 일정</h2>
          <span className={styles.weekRange}>{weekLabel}</span>
        </div>

        <div className={styles.controls}>
          <div className={styles.filterWrap} ref={filterWrapRef}>
            <button
              type="button"
              className={styles.filterButton}
              data-active={filter !== 'all' ? 'true' : undefined}
              aria-haspopup="listbox"
              aria-expanded={isFilterOpen}
              onClick={() => setIsFilterOpen((prev) => !prev)}
            >
              <svg
                className={styles.funnelIcon}
                width={14}
                height={14}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              <span>{filter === 'all' ? '필터' : selectedFilterLabel}</span>
            </button>

            {isFilterOpen ? (
              <div className={styles.filterMenu} role="listbox" aria-label="업무 일정 필터">
                {FILTER_OPTIONS.map((opt) => {
                  const selected = opt.value === filter
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={styles.filterOption}
                      data-selected={selected ? 'true' : undefined}
                      onClick={() => {
                        onFilterChange(opt.value)
                        setIsFilterOpen(false)
                      }}
                    >
                      <span>{opt.label}</span>
                      {selected ? <Icon name="checkCircle" size={14} /> : null}
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>

          <button className={styles.todayButton} type="button" onClick={onGoToday}>
            오늘
          </button>

          <div className={styles.navGroup}>
            <button
              className={styles.navButton}
              type="button"
              aria-label="이전 주"
              onClick={() => onShiftWeek(-1)}
            >
              <Icon name="chevronLeft" size={15} />
            </button>
            <button
              className={styles.navButton}
              type="button"
              aria-label="다음 주"
              onClick={() => onShiftWeek(1)}
            >
              <Icon name="chevronRight" size={15} />
            </button>
          </div>
        </div>
      </header>

      <div className={styles.tableContainer}>
        <div className={styles.tableHead} role="row">
          <span className={styles.colTask}>업무명</span>
          <span className={styles.colWorkspace}>워크스페이스</span>
          <span className={styles.colStatus}>상태</span>
          <span className={styles.colDue}>마감일</span>
        </div>

        <div className={styles.tableBody}>
          {rows.length === 0 ? (
            <p className={styles.empty}>{EMPTY_TABLE_MESSAGE}</p>
          ) : (
            rows.map((row) => {
              const pillVariant = resolveStatusPillVariant(row)

              return (
                <div
                  key={row.workItemId}
                  role="row"
                  tabIndex={0}
                  className={styles.tableRow}
                  onClick={() => navigate(`/work-items/${row.workItemId}`)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      navigate(`/work-items/${row.workItemId}`)
                    }
                  }}
                  onContextMenu={(event) => onWorkItemContextMenu(event, row.workItemId)}
                >
                  <div className={styles.taskCell}>
                    <span className={styles.taskTitle}>{row.title}</span>
                    <span className={styles.taskCategory}>{row.categoryLabel}</span>
                  </div>

                  <div className={styles.workspaceCell} title={row.nodeTitle}>
                    <span className={styles.workspaceBadge} aria-hidden="true">
                      <Icon name="building" size={13} />
                    </span>
                    <span className={styles.workspaceName}>{row.nodeTitle}</span>
                  </div>

                  <div className={styles.statusCell}>
                    <span className={styles.statusPill} data-variant={pillVariant}>
                      {row.statusLabel}
                    </span>
                  </div>

                  <div
                    className={styles.dueCell}
                    data-overdue={row.isOverdue ? 'true' : undefined}
                  >
                    {row.dueDateShort}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      <footer className={styles.footer}>
        <span className={styles.remainingText}>
          이번 주 남은 마감 <strong>{weekRemainingCount}건</strong>
        </span>

        <button type="button" className={styles.viewAllButton} onClick={onViewAll}>
          <span>전체 보기</span>
          <span className={styles.arrowDiag} aria-hidden="true">↗</span>
        </button>
      </footer>

      {workItemContextMenu}
    </section>
  )
}