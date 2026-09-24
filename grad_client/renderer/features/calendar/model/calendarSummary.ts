import { addDays, parseDateKey, readDateKey, toDateKey } from '../../dashboard/model/dashboardSummary'
import type { DashboardRecurringRule, DashboardWorkItem } from '../../dashboard/model/dashboardTypes'
import { getHolidayLabel } from '../../workspace/model/koreanHolidays'
import { getSchedulesForCalendarDate } from '../../workspace/model/recurringCalendar'
import type { RecurringCategory } from '../../workspace/model/recurringRuleTypes'
import type { CalendarChip, CalendarChipTone, CalendarDayCell, CalendarOngoingItem } from './calendarTypes'

export const CALENDAR_WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'] as const

/** 한 달은 6주(42칸)로 그린다. */
export const CALENDAR_CELL_COUNT = 42

/** 정기 일정 카테고리 → 칩 톤 */
const SCHEDULE_TONE_BY_CATEGORY: Record<RecurringCategory, CalendarChipTone> = {
  MEETING: 'info',
  REPORT: 'warning',
  INSPECTION: 'success',
  EVENT: 'brand',
  ROUTINE: 'muted',
}


/** 선택한 업무 기간 안에서 그 날짜가 어디에 놓이는지 */
export type CalendarRangeState = 'start' | 'middle' | 'end' | 'single'

export function getCalendarRangeState(
  dateKey: string,
  startKey: string | null,
  endKey: string | null,
): CalendarRangeState | null {
  if (!startKey || !endKey) return null

  const from = startKey <= endKey ? startKey : endKey
  const to = startKey <= endKey ? endKey : startKey

  if (dateKey < from || dateKey > to) return null
  if (from === to) return 'single'
  if (dateKey === from) return 'start'
  if (dateKey === to) return 'end'

  return 'middle'
}

export function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

export function shiftMonth(date: Date, delta: number) {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1)
}

/** '2026년 5월' */
export function formatMonthLabel(date: Date) {
  return date.getFullYear() + '년 ' + (date.getMonth() + 1) + '월'
}

/** '2026-05-15 (금)' */
export function formatCalendarFullDate(dateKey: string) {
  const date = parseDateKey(dateKey)
  return date ? dateKey + ' (' + CALENDAR_WEEKDAY_LABELS[date.getDay()] + ')' : dateKey
}

/** '2026-05-07 14:20' */
export function formatCalendarDateTime(value?: string | null) {
  if (!value) return '-'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 16).replace('T', ' ')

  const dateKey = toDateKey(date)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return dateKey + ' ' + hours + ':' + minutes
}

/** '10:30' — 시작 시간만 뽑아낸다. */
export function readTimeLabel(startTime?: string | null) {
  const match = startTime?.match(/^(\d{1,2}):(\d{2})/)
  return match ? match[1].padStart(2, '0') + ':' + match[2] : null
}

/** '10:30 ~ 11:30' 또는 '종일' */
export function formatCalendarTimeRange(startTime?: string | null, durationMinutes?: number | null) {
  const start = readTimeLabel(startTime)
  if (!start) return '종일'

  if (!durationMinutes || durationMinutes <= 0) return start

  const [hour, minute] = start.split(':').map(Number)
  const endMinutes = hour * 60 + minute + durationMinutes
  const endHour = Math.floor(endMinutes / 60) % 24
  const endMinute = endMinutes % 60
  return start + ' ~ ' + String(endHour).padStart(2, '0') + ':' + String(endMinute).padStart(2, '0')
}

/**
 * 마감 업무 칩 톤.
 * 업무 일정 패널과 같은 규칙으로 마감은 빨강, 마감일이 지난 미완료 업무는 지연(주황)으로 고정한다.
 */
function resolveDueTone(item: DashboardWorkItem, dateKey: string, todayKey: string): CalendarChipTone {
  if (item.status !== 'done' && dateKey < todayKey) {
    return 'warning'
  }

  return 'danger'
}

function sortByPriorityThenTitle<T extends { priority: number; title: string }>(items: T[]) {
  return items
    .slice()
    .sort((left, right) => right.priority - left.priority || left.title.localeCompare(right.title, 'ko'))
}

function toEventChip(
  item: DashboardWorkItem,
  kind: 'start' | 'due',
  dateKey: string,
  todayKey: string,
): CalendarChip {
  return {
    key: kind + '-' + item.workItemId,
    kind,
    title: item.title,
    timeLabel: null,
    // 시작은 초록, 마감은 빨강 계열로 고정해 업무 흐름을 색만으로 읽을 수 있게 한다.
    tone: kind === 'start' ? 'success' : resolveDueTone(item, dateKey, todayKey),
    workItemId: item.workItemId,
  }
}

type WorkItemIndex = {
  byStartDate: Map<string, DashboardWorkItem[]>
  byDueDate: Map<string, DashboardWorkItem[]>
  /** 진행 중이면서 마감일이 있는 업무 (그날 걸쳐 있는지 계산에 쓴다) */
  ongoingCandidates: DashboardWorkItem[]
}

function indexWorkItems(workItems: DashboardWorkItem[]): WorkItemIndex {
  const byStartDate = new Map<string, DashboardWorkItem[]>()
  const byDueDate = new Map<string, DashboardWorkItem[]>()
  const ongoingCandidates: DashboardWorkItem[] = []

  workItems
    .filter((item) => !item.isDeleted)
    .forEach((item) => {
      const startKey = readDateKey(item.startDate)
      const dueKey = readDateKey(item.dueDate)

      if (startKey) {
        const bucket = byStartDate.get(startKey) ?? []
        bucket.push(item)
        byStartDate.set(startKey, bucket)
      }

      if (dueKey) {
        const bucket = byDueDate.get(dueKey) ?? []
        bucket.push(item)
        byDueDate.set(dueKey, bucket)
      }

      // 진행 중 업무는 마감일이 있는 것만 기간으로 본다. 마감 미정 업무는 달력에 놓을 자리가 없다.
      if (item.status === 'in-progress' && dueKey) {
        ongoingCandidates.push(item)
      }
    })

  return { byStartDate, byDueDate, ongoingCandidates }
}

/**
 * 월간 캘린더의 42칸(일요일 시작).
 * 각 칸에는 그날 발생하는 정기 일정, 그날 시작/마감하는 업무, 그날 걸쳐 있는 진행 중 업무가 담긴다.
 */
export function buildMonthCells(
  month: Date,
  workItems: DashboardWorkItem[],
  rules: DashboardRecurringRule[],
  today: Date,
): CalendarDayCell[] {
  const monthStart = startOfMonth(month)
  const todayKey = toDateKey(today)
  const gridStart = addDays(monthStart, -monthStart.getDay())
  const index = indexWorkItems(workItems)

  return Array.from({ length: CALENDAR_CELL_COUNT }, (_, cellIndex) => {
    const date = addDays(gridStart, cellIndex)
    const key = toDateKey(date)

    // 같은 날이면 마감을 먼저, 시작을 나중에 보여준다 (업무 일정 패널과 같은 순서).
    const events: CalendarChip[] = [
      ...sortByPriorityThenTitle(index.byDueDate.get(key) ?? []).map((item) =>
        toEventChip(item, 'due', key, todayKey),
      ),
      ...sortByPriorityThenTitle(index.byStartDate.get(key) ?? []).map((item) =>
        toEventChip(item, 'start', key, todayKey),
      ),
    ]

    const schedules: CalendarChip[] = getSchedulesForCalendarDate(rules, key).map((rule) => ({
      key: 'schedule-' + rule.ruleId,
      kind: 'schedule' as const,
      title: rule.title,
      timeLabel: readTimeLabel(rule.startTime),
      tone: SCHEDULE_TONE_BY_CATEGORY[rule.category as RecurringCategory] ?? 'info',
      ruleId: rule.ruleId,
    }))

    // 시작일/마감일 당일은 이벤트로 이미 보이므로 진행 중 목록에서는 뺀다.
    const ongoing: CalendarOngoingItem[] = sortByPriorityThenTitle(
      index.ongoingCandidates.filter((item) => {
        const startKey = readDateKey(item.startDate)
        const dueKey = readDateKey(item.dueDate) as string

        if (startKey === key || dueKey === key) return false
        if (startKey && key < startKey) return false

        return key < dueKey
      }),
    ).map((item) => ({
      key: 'ongoing-' + item.workItemId,
      kind: 'ongoing' as const,
      title: item.title,
      tone: 'info' as const,
      workItemId: item.workItemId,
    }))

    return {
      key,
      dayNumber: date.getDate(),
      isCurrentMonth:
        date.getFullYear() === monthStart.getFullYear() && date.getMonth() === monthStart.getMonth(),
      isToday: key === todayKey,
      isSunday: date.getDay() === 0,
      isSaturday: date.getDay() === 6,
      holiday: getHolidayLabel(key),
      events,
      schedules,
      ongoing,
    }
  })
}
