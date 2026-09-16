import { formatWorkspaceMonthDay } from '../../workspace/model/formatters'
import { getWorkItemStatusLabel } from '../../workspace/model/labels'
import type { RecurringRuleRecord } from '../../workspace/model/recurringRuleTypes'
import { formatRepeatSummary, getNextOccurrenceInfo } from '../../workspace/model/recurringSchedule'
import type { WorkItemRecord } from '../../workspace/model/types'
import type {
  DashboardCalendarDay,
  DashboardDateRange,
  DashboardMetrics,
  DashboardSchedule,
  DashboardTaskAccent,
  DashboardTaskRow,
  DashboardWindow,
} from './dashboardTypes'

const DATE_KEY_PATTERN = /(\d{4})-(\d{2})-(\d{2})/
const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']

/** 업무 일정 스트립은 선택한 날짜를 가운데 두고 2주를 보여준다. (6일 전 ~ 7일 후) */
export const CALENDAR_WINDOW_DAYS = 14
const CALENDAR_WINDOW_LEAD_DAYS = Math.floor((CALENDAR_WINDOW_DAYS - 1) / 2)

/** '3일 이내 마감' 기준 */
const DUE_SOON_DAYS = 3

const MAX_DOT_COUNT = 3

/** 업무 목록은 그날 마감 → 그날 시작 → 그날 진행 중 순으로 보여준다. */
const TASK_ACCENT_ORDER: Record<DashboardTaskAccent, number> = {
  due: 0,
  start: 1,
  ongoing: 2,
}

const SELECTED_DATE_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  month: 'long',
  day: 'numeric',
  weekday: 'short',
})
const SCHEDULE_DATE_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  month: 'long',
  day: 'numeric',
  weekday: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
  dayPeriod: 'long',
})

function pad(value: number) {
  return String(value).padStart(2, '0')
}

export function toDateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** ISO 계열 날짜 문자열에서 'YYYY-MM-DD'만 뽑아낸다. */
export function readDateKey(value?: string) {
  const match = value?.match(DATE_KEY_PATTERN)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null
}

export function parseDateKey(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)

  if (!match) {
    return null
  }

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

export function addDays(date: Date, days: number) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  next.setDate(next.getDate() + days)
  return next
}

/** 서버가 내려준 오늘 날짜를 우선 사용하고, 없으면 기기 날짜를 쓴다. */
export function resolveTodayDate(anchor?: string | null) {
  const normalizedKey = readDateKey(anchor ?? undefined)
  const parsed = normalizedKey ? parseDateKey(normalizedKey) : null

  if (parsed) {
    return parsed
  }

  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

export function getWeekWindow(today: Date) {
  const weekdayOffset = (today.getDay() + 6) % 7
  const start = addDays(today, -weekdayOffset)

  return { start, end: addDays(start, 6) }
}

/** 선택한 날짜를 가운데 두는 2주 구간을 만든다. */
export function buildCalendarWindow(anchorDate: Date): DashboardWindow {
  const start = addDays(anchorDate, -CALENDAR_WINDOW_LEAD_DAYS)

  return { start, end: addDays(start, CALENDAR_WINDOW_DAYS - 1) }
}

/** 대시보드 업무 일정에서 고를 수 있는 범위 (오늘 기준 ±6개월) */
export const SELECTABLE_MONTH_RANGE = 6

/** 날짜에 개월 수를 더한다. 대상 달에 없는 일자는 말일로 맞춘다. */
function addMonths(date: Date, months: number) {
  const monthIndex = date.getMonth() + months
  const targetYear = date.getFullYear() + Math.floor(monthIndex / 12)
  const targetMonth = ((monthIndex % 12) + 12) % 12
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate()

  return new Date(targetYear, targetMonth, Math.min(date.getDate(), lastDay))
}

/** 오늘을 기준으로 고를 수 있는 날짜 범위를 만든다. */
export function buildSelectableDateRange(today: Date): DashboardDateRange {
  return {
    minDateKey: toDateKey(addMonths(today, -SELECTABLE_MONTH_RANGE)),
    maxDateKey: toDateKey(addMonths(today, SELECTABLE_MONTH_RANGE)),
  }
}

/** 고를 수 있는 범위 안의 날짜인지 확인한다. */
export function isDateKeySelectable(dateKey: string, range: DashboardDateRange) {
  return dateKey >= range.minDateKey && dateKey <= range.maxDateKey
}

/** 범위를 벗어난 날짜는 가까운 경계일로 당긴다. */
export function clampDateKeyToRange(dateKey: string, range: DashboardDateRange) {
  if (dateKey < range.minDateKey) {
    return range.minDateKey
  }

  if (dateKey > range.maxDateKey) {
    return range.maxDateKey
  }

  return dateKey
}

/** 업무 일정 헤더에 쓰는 '9월 16일 (수)' 형태 라벨 */
export function formatCalendarDateLabel(dateKey: string) {
  const date = parseDateKey(dateKey)
  return date ? SELECTED_DATE_FORMATTER.format(date) : dateKey
}

function formatMonthDay(value?: string) {
  const dateKey = readDateKey(value)
  return dateKey ? formatWorkspaceMonthDay(dateKey) : null
}

/** 업무가 차지하는 기간(일자~마감). 한쪽만 있으면 그 날짜 하루로 본다. */
function getWorkItemRange(item: WorkItemRecord) {
  const startKey = readDateKey(item.startDate) ?? readDateKey(item.dueDate) ?? readDateKey(item.createdAt)
  const dueKey = readDateKey(item.dueDate) ?? readDateKey(item.startDate) ?? readDateKey(item.createdAt)

  return { startKey, dueKey }
}

function getReferenceDateKey(item: WorkItemRecord) {
  return readDateKey(item.dueDate) ?? readDateKey(item.startDate) ?? readDateKey(item.createdAt)
}

function isDone(item: WorkItemRecord) {
  return item.status === 'done'
}

function compareByDate(left: WorkItemRecord, right: WorkItemRecord) {
  const leftKey = readDateKey(left.startDate) ?? readDateKey(left.dueDate) ?? '9999-12-31'
  const rightKey = readDateKey(right.startDate) ?? readDateKey(right.dueDate) ?? '9999-12-31'
  return leftKey.localeCompare(rightKey)
}

export function buildMetrics(
  workItems: WorkItemRecord[],
  today: Date,
  weekStart: Date,
  weekEnd: Date,
): DashboardMetrics {
  const todayKey = toDateKey(today)
  const weekStartKey = toDateKey(weekStart)
  const weekEndKey = toDateKey(weekEnd)
  const dueSoonLimitKey = toDateKey(addDays(today, DUE_SOON_DAYS))

  const activeItems = workItems.filter((item) => item.status === 'in-progress')
  const todayWorkItems = workItems.filter(
    (item) => readDateKey(item.startDate) === todayKey || readDateKey(item.dueDate) === todayKey,
  )
  const weekItems = workItems.filter((item) => {
    const referenceKey = getReferenceDateKey(item)
    return referenceKey !== null && referenceKey >= weekStartKey && referenceKey <= weekEndKey
  })
  const weekDoneCount = weekItems.filter(isDone).length
  const openItems = workItems.filter((item) => !isDone(item))
  const dueTodayCount = openItems.filter((item) => readDateKey(item.dueDate) === todayKey).length
  const dueSoonCount = openItems.filter((item) => {
    const dueKey = readDateKey(item.dueDate)
    return dueKey !== null && dueKey >= todayKey && dueKey <= dueSoonLimitKey
  }).length

  const nearestDueItem = openItems
    .filter((item) => {
      const dueKey = readDateKey(item.dueDate)
      return dueKey !== null && dueKey >= todayKey
    })
    .sort((left, right) => (readDateKey(left.dueDate) ?? '').localeCompare(readDateKey(right.dueDate) ?? ''))[0]

  return {
    activeCount: activeItems.length,
    todayWorkCount: todayWorkItems.length,
    weekProgress: weekItems.length > 0 ? Math.round((weekDoneCount / weekItems.length) * 100) : 0,
    weekDoneCount,
    weekTotalCount: weekItems.length,
    dueTodayCount,
    dueSoonCount,
    nearestDue: nearestDueItem
      ? {
          workItemId: nearestDueItem.workItemId,
          title: nearestDueItem.title,
          dateLabel: formatMonthDay(nearestDueItem.dueDate) ?? '',
        }
      : null,
  }
}

export function buildCalendarDays(
  workItems: WorkItemRecord[],
  window: DashboardWindow,
  today: Date,
  range: DashboardDateRange,
): DashboardCalendarDay[] {
  const todayKey = toDateKey(today)
  const taskCountByDate = new Map<string, number>()

  workItems
    .filter((item) => !item.isDeleted)
    .forEach((item) => {
      const { startKey, dueKey } = getWorkItemRange(item)
      const keys = new Set([startKey, dueKey].filter(Boolean) as string[])
      keys.forEach((key) => taskCountByDate.set(key, (taskCountByDate.get(key) ?? 0) + 1))
    })

  return Array.from({ length: CALENDAR_WINDOW_DAYS }, (_, index) => {
    const date = addDays(window.start, index)
    const key = toDateKey(date)
    const taskCount = taskCountByDate.get(key) ?? 0

    return {
      key,
      dayLabel: String(date.getDate()),
      weekdayLabel: WEEKDAY_LABELS[date.getDay()],
      isToday: key === todayKey,
      isSelectable: isDateKeySelectable(key, range),
      dotCount: Math.min(taskCount, MAX_DOT_COUNT),
    }
  })
}

/** 선택한 날짜를 기준으로 시작/진행 중/마감을 구분한다. (같은 날이면 마감 우선) */
function resolveAccentTone(item: WorkItemRecord, dateKey: string): DashboardTaskAccent {
  const { startKey, dueKey } = getWorkItemRange(item)

  if (dueKey === dateKey) {
    return 'due'
  }

  if (startKey === dateKey) {
    return 'start'
  }

  return 'ongoing'
}

/**
 * 업무 일정 목록 — 선택한 하루 기준.
 * 그 날짜가 업무 기간(일자~마감)에 포함되면 모두 표시하고, 마감 → 시작 → 진행 중 순으로 정렬한다.
 */
export function buildTaskRows(workItems: WorkItemRecord[], dateKey: string): DashboardTaskRow[] {
  return workItems
    .filter((item) => {
      if (item.isDeleted) return false

      const { startKey, dueKey } = getWorkItemRange(item)

      if (!startKey || !dueKey) {
        return false
      }

      return startKey <= dateKey && dueKey >= dateKey
    })
    .sort(
      (left, right) =>
        TASK_ACCENT_ORDER[resolveAccentTone(left, dateKey)] -
          TASK_ACCENT_ORDER[resolveAccentTone(right, dateKey)] ||
        compareByDate(left, right),
    )
    .map((item) => ({
      workItemId: item.workItemId,
      title: item.title,
      status: item.status,
      statusLabel: getWorkItemStatusLabel(item.status),
      startLabel: formatMonthDay(item.startDate),
      dueLabel: formatMonthDay(item.dueDate),
      accentTone: resolveAccentTone(item, dateKey),
    }))
}

export function buildScheduleCards(
  rules: RecurringRuleRecord[],
  today: Date,
  limit?: number,
): DashboardSchedule[] {
  return rules
    .filter((rule) => rule.isActive && !rule.isDeleted)
    .map((rule) => ({ rule, occurrence: getNextOccurrenceInfo(rule, today) }))
    .filter((entry) => entry.occurrence.nextDate !== null)
    .sort((left, right) => {
      const leftTime = left.occurrence.nextDate?.getTime() ?? 0
      const rightTime = right.occurrence.nextDate?.getTime() ?? 0
      return leftTime - rightTime
    })
    .slice(0, limit)
    .map((entry, index) => ({
      ruleId: entry.rule.ruleId,
      title: entry.rule.title,
      description: entry.rule.description?.trim() ?? '',
      category: entry.rule.category,
      // 가장 가까운 일정만 '다가오는 일정', 나머지는 '정기 일정'으로 구분한다.
      badgeLabel: index === 0 ? '다가오는 일정' : '정기 일정',
      dateLabel: entry.occurrence.nextDate
        ? SCHEDULE_DATE_FORMATTER.format(entry.occurrence.nextDate)
        : entry.occurrence.dateString,
      repeatLabel: formatRepeatSummary(entry.rule),
    }))
}

/** 좌우 화살표: 선택 날짜를 하루 이동시킨다. 스트립은 선택 날짜를 가운데 두고 다시 그려진다. */
export function shiftSelectedDateKey(dateKey: string, direction: number) {
  const date = parseDateKey(dateKey) ?? new Date()
  return toDateKey(addDays(date, direction))
}