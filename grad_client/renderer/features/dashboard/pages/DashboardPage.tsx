import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import { DashboardSchedulePanel } from '../components/DashboardSchedulePanel'
import { DashboardSummaryCards } from '../components/DashboardSummaryCards'
import { DashboardWorkSchedulePanel } from '../components/DashboardWorkSchedulePanel'
import { RecurringRuleDetailModal } from '../../workspace/components/RecurringRuleDetailModal'
import { getOrgSnapshot } from '../../workspace/data/orgService'
import { useKoreanHolidays } from '../../workspace/model/koreanHolidays'
import { useDashboardContext } from '../data/useDashboardContext'
import type { DashboardRecurringRule, DashboardWorkItem } from '../model/dashboardTypes'
import {
  buildMetrics,
  buildScheduleCards,
  buildSelectableDateRange,
  buildWeekBoard,
  clampDateKeyToRange,
  formatWeekRangeLabel,
  getWeekWindow,
  isDateKeySelectable,
  parseDateKey,
  resolveTodayDate,
  shiftWeekDateKey,
  toDateKey,
} from '../model/dashboardSummary'
import styles from './DashboardPage.module.css'

const EMPTY_WORK_ITEMS: DashboardWorkItem[] = []
const EMPTY_RECURRING_RULES: DashboardRecurringRule[] = []

const LOADING_MESSAGE = '대시보드를 불러오는 중입니다.'
const FALLBACK_ERROR_MESSAGE = '대시보드 정보를 불러오지 못했습니다.'

export function DashboardPage() {
  const { status, context, error, reload } = useDashboardContext()
  const navigate = useNavigate()
  // 보고 있는 주의 기준 날짜. 따로 고른 날짜가 없으면 오늘이 속한 주를 보여준다.
  const [anchorDateKey, setAnchorDateKey] = useState<string | null>(null)
  const [openedScheduleRuleId, setOpenedScheduleRuleId] = useState<number | null>(null)

  const viewerToday = context?.viewer?.today ?? null
  const workItems = context?.workItems ?? EMPTY_WORK_ITEMS
  const recurringRules = context?.recurringRules ?? EMPTY_RECURRING_RULES

  const today = useMemo(() => resolveTodayDate(viewerToday), [viewerToday])
  // 공휴일 데이터가 늦게 도착해도 '다음 발생'이 공휴일 정책에 맞게 다시 계산되도록 구독한다.
  const holidayRevision = useKoreanHolidays([
    today.getFullYear() - 1,
    today.getFullYear(),
    today.getFullYear() + 1,
  ])
  const todayKey = useMemo(() => toDateKey(today), [today])
  const activeDateKey = anchorDateKey ?? todayKey
  const activeDate = useMemo(() => parseDateKey(activeDateKey) ?? today, [activeDateKey, today])

  // 오늘 기준 ±6개월 밖의 날짜는 고를 수 없다.
  const selectableRange = useMemo(() => buildSelectableDateRange(today), [today])

  const handleGoToday = useCallback(() => {
    setAnchorDateKey(todayKey)
  }, [todayKey])

  const handleShiftWeek = useCallback(
    (direction: number) => {
      setAnchorDateKey(clampDateKeyToRange(shiftWeekDateKey(activeDateKey, direction), selectableRange))
    },
    [activeDateKey, selectableRange],
  )

  // 상단 카드 지표는 언제나 오늘이 속한 주를 기준으로 계산한다.
  const week = useMemo(() => getWeekWindow(today), [today])
  const metrics = useMemo(
    () => buildMetrics(workItems, today, week.start, week.end),
    [workItems, today, week],
  )
  // 업무 일정 패널은 보고 있는 주(월~일)를 그린다.
  const boardWeek = useMemo(() => getWeekWindow(activeDate), [activeDate])
  const weekStartKey = useMemo(() => toDateKey(boardWeek.start), [boardWeek])
  const weekEndKey = useMemo(() => toDateKey(boardWeek.end), [boardWeek])
  const weekLabel = useMemo(
    () => formatWeekRangeLabel(weekStartKey, weekEndKey),
    [weekStartKey, weekEndKey],
  )
  const board = useMemo(
    () => buildWeekBoard(workItems, boardWeek.start, today),
    [workItems, boardWeek, today],
  )
  // 오늘이 보고 있는 주에 있으면 오늘 요일 그룹에, 없으면 기준 날짜에 머문다.
  const focusDateKey = useMemo(() => {
    const todayInWeek = todayKey >= weekStartKey && todayKey <= weekEndKey
    const key = todayInWeek ? todayKey : activeDateKey

    return isDateKeySelectable(key, selectableRange) ? key : weekStartKey
  }, [todayKey, weekStartKey, weekEndKey, activeDateKey, selectableRange])
  const schedules = useMemo(() => {
    void holidayRevision
    return buildScheduleCards(recurringRules, today)
  }, [recurringRules, today, holidayRevision])
  // '일정 보기'로 연 정기 일정 상세
  const orgMembers = useMemo(() => getOrgSnapshot().users, [])
  const openedScheduleRule = useMemo(
    () => recurringRules.find((rule) => rule.ruleId === openedScheduleRuleId) ?? null,
    [recurringRules, openedScheduleRuleId],
  )
  // 일정 목록은 그 일정이 속한 워크스페이스의 일정 탭으로 보낸다.
  const scheduleListHref = useMemo(() => {
    const ownerNodeId = openedScheduleRule?.ownerNodeId

    return ownerNodeId ? `/workspace?view=schedules&nodeId=${ownerNodeId}` : '/workspace?view=schedules'
  }, [openedScheduleRule])

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
          board={board}
          focusDateKey={focusDateKey}
          weekLabel={weekLabel}
          onShiftWeek={handleShiftWeek}
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
            navigate(scheduleListHref)
          }}
        />
      ) : null}
    </section>
  )
}
