import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import type { RecurringRuleRecord } from '../../workspace/model/recurringRuleTypes'
import type { WorkItemRecord } from '../../workspace/model/types'
import { DashboardSchedulePanel } from '../components/DashboardSchedulePanel'
import { DashboardSummaryCards } from '../components/DashboardSummaryCards'
import { DashboardWorkSchedulePanel } from '../components/DashboardWorkSchedulePanel'
import { RecurringRuleDetailModal } from '../../workspace/components/RecurringRuleDetailModal'
import { getOrgSnapshot } from '../../workspace/data/orgService'
import { useDashboardContext } from '../data/useDashboardContext'
import {
  buildCalendarDays,
  buildCalendarWindow,
  buildMetrics,
  buildScheduleCards,
  buildSelectableDateRange,
  buildTaskRows,
  clampDateKeyToRange,
  formatCalendarDateLabel,
  getWeekWindow,
  parseDateKey,
  resolveTodayDate,
  shiftSelectedDateKey,
  toDateKey,
} from '../model/dashboardSummary'
import styles from './DashboardPage.module.css'

const EMPTY_WORK_ITEMS: WorkItemRecord[] = []
const EMPTY_RECURRING_RULES: RecurringRuleRecord[] = []

const LOADING_MESSAGE = '대시보드를 불러오는 중입니다.'
const FALLBACK_ERROR_MESSAGE = '대시보드 정보를 불러오지 못했습니다.'

export function DashboardPage() {
  const { status, context, error, reload } = useDashboardContext()
  const navigate = useNavigate()
  const [selectedDateKey, setSelectedDateKey] = useState<string | null>(null)
  const [openedScheduleRuleId, setOpenedScheduleRuleId] = useState<number | null>(null)

  const viewerToday = context?.viewer?.today ?? null
  const workItems = context?.workItems ?? EMPTY_WORK_ITEMS
  const recurringRules = context?.recurringRules ?? EMPTY_RECURRING_RULES

  const today = useMemo(() => resolveTodayDate(viewerToday), [viewerToday])
  const todayKey = useMemo(() => toDateKey(today), [today])
  // 따로 고른 날짜가 없으면 오늘 하루를 보여준다.
  const activeDateKey = selectedDateKey ?? todayKey
  const activeDate = useMemo(() => parseDateKey(activeDateKey) ?? today, [activeDateKey, today])
  const activeDateLabel = useMemo(() => formatCalendarDateLabel(activeDateKey), [activeDateKey])

  // 오늘 기준 ±6개월 밖의 날짜는 고를 수 없다.
  const selectableRange = useMemo(() => buildSelectableDateRange(today), [today])

  // 드롭다운에서 지우기를 누르면 선택이 없는 상태(= 오늘)로 되돌린다.
  const handleSelectDate = useCallback(
    (dateKey: string) => {
      setSelectedDateKey(dateKey.length > 0 ? clampDateKeyToRange(dateKey, selectableRange) : null)
    },
    [selectableRange],
  )

  const handleGoToday = useCallback(() => {
    setSelectedDateKey(todayKey)
  }, [todayKey])

  const handleShiftDate = useCallback(
    (direction: number) => {
      setSelectedDateKey(clampDateKeyToRange(shiftSelectedDateKey(activeDateKey, direction), selectableRange))
    },
    [activeDateKey, selectableRange],
  )

  const week = useMemo(() => getWeekWindow(today), [today])
  const metrics = useMemo(
    () => buildMetrics(workItems, today, week.start, week.end),
    [workItems, today, week],
  )
  // 달력 스트립은 항상 선택한 날짜를 가운데 둔다.
  const calendarWindow = useMemo(() => buildCalendarWindow(activeDate), [activeDate])
  const calendarDays = useMemo(
    () => buildCalendarDays(workItems, calendarWindow, today, selectableRange),
    [workItems, calendarWindow, today, selectableRange],
  )
  const taskRows = useMemo(
    () => buildTaskRows(workItems, activeDateKey),
    [workItems, activeDateKey],
  )
  const schedules = useMemo(() => buildScheduleCards(recurringRules, today), [recurringRules, today])
  // '일정 보기'로 연 정기 일정 상세
  const orgMembers = useMemo(() => getOrgSnapshot().users, [])
  const openedScheduleRule = useMemo(
    () => recurringRules.find((rule) => rule.ruleId === openedScheduleRuleId) ?? null,
    [recurringRules, openedScheduleRuleId],
  )

  if (status === 'loading') {
    return (
      <section className={styles.page}>
        <div className={styles.stateCard} aria-busy="true" aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          <p className={styles.stateMessage}>{LOADING_MESSAGE}</p>
        </div>
      </section>
    )
  }

  if (status === 'error') {
    return (
      <section className={styles.page}>
        <div className={styles.stateCard} role="alert">
          <Icon name="alertTriangle" size={22} className={styles.stateIcon} />
          <p className={styles.stateMessage}>{error ?? FALLBACK_ERROR_MESSAGE}</p>
          <button className={styles.retryButton} type="button" onClick={reload}>
            다시 시도
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className={styles.page}>
      <DashboardSummaryCards metrics={metrics} />

      <div className={styles.columns}>
        <DashboardSchedulePanel schedules={schedules} onOpenSchedule={setOpenedScheduleRuleId} />
        <DashboardWorkSchedulePanel
          days={calendarDays}
          rows={taskRows}
          selectedDateKey={activeDateKey}
          selectedDateLabel={activeDateLabel}
          minSelectableDateKey={selectableRange.minDateKey}
          maxSelectableDateKey={selectableRange.maxDateKey}
          onSelectDate={handleSelectDate}
          onShiftDate={handleShiftDate}
          onGoToday={handleGoToday}
        />
      </div>

      {openedScheduleRule ? (
        <RecurringRuleDetailModal
          isOpen
          rule={openedScheduleRule}
          members={orgMembers}
          onClose={() => setOpenedScheduleRuleId(null)}
          onNavigateToList={() => {
            setOpenedScheduleRuleId(null)
            navigate('/workspace?view=schedules')
          }}
        />
      ) : null}
    </section>
  )
}
