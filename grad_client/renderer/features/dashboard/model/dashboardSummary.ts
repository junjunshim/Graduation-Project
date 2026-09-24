import { formatWorkspaceMonthDay } from '../../workspace/model/formatters'
import { getRecurringCategoryLabel, getWorkItemStatusLabel } from '../../workspace/model/labels'
import { formatRepeatSummary, getNextOccurrenceInfo } from '../../workspace/model/recurringSchedule'
import type { WorkItemRecord } from '../../workspace/model/types'
import type { DashboardRecurringRule, DashboardWorkItem } from './dashboardTypes'
import type {
  DashboardDateRange,
  DashboardMetrics,
  DashboardSchedule,
  DashboardTaskAccent,
  DashboardTaskRow,
  DashboardWeekBoard,
  DashboardWeekDay,
} from './dashboardTypes'

const DATE_KEY_PATTERN = /(\d{4})-(\d{2})-(\d{2})/
const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']

/** 업무 일정은 월요일부터 일요일까지 한 주를 보여준다. */
export const WEEK_DAY_COUNT = 7

/** '3일 이내 마감' 기준 */
const DUE_SOON_DAYS = 3


/** 같은 날 이벤트는 그날 마감 → 그날 시작 순으로 보여준다. */
const EVENT_TONE_ORDER: Record<'due' | 'start', number> = {
  due: 0,
  start: 1,
}

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

/** 업무 일정 헤더에 쓰는 '9월 15일 ~ 9월 21일' 형태 라벨 */
export function formatWeekRangeLabel(startKey: string, endKey: string) {
  const start = parseDateKey(startKey)
  const end = parseDateKey(endKey)

  if (!start || !end) {
    return `${startKey} ~ ${endKey}`
  }

  return `${start.getMonth() + 1}월 ${start.getDate()}일 ~ ${end.getMonth() + 1}월 ${end.getDate()}일`
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

/** 업무 기간(일자~마감)에 해당 날짜가 포함되는지. 업무 일정 패널에 보이는 기준과 같다. */
function isWorkItemOnDate(item: WorkItemRecord, dateKey: string) {
  if (item.isDeleted) {
    return false
  }

  const { startKey, dueKey } = getWorkItemRange(item)

  return startKey !== null && dueKey !== null && startKey <= dateKey && dueKey >= dateKey
}

function isDone(item: WorkItemRecord) {
  return item.status === 'done'
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

  const visibleItems = workItems.filter((item) => !item.isDeleted)
  const activeItems = visibleItems.filter((item) => item.status === 'in-progress')
  // 진행 중인 업무 중 오늘 날짜가 업무 기간(일자~마감)에 포함된 업무
  const todayActiveItems = activeItems.filter((item) => isWorkItemOnDate(item, todayKey))
  // 이번 주에 마감해야 하는 업무 = 마감일이 이번 주에 있는 업무 (마감일 없는 업무는 제외)
  const weekItems = visibleItems.filter((item) => {
    const dueKey = readDateKey(item.dueDate)
    return dueKey !== null && dueKey >= weekStartKey && dueKey <= weekEndKey
  })
  const weekDoneCount = weekItems.filter(isDone).length
  const weekRemainingCount = weekItems.filter((item) => !isDone(item)).length
  const openItems = visibleItems.filter((item) => !isDone(item))
  const dueTodayCount = openItems.filter((item) => readDateKey(item.dueDate) === todayKey).length
  const dueSoonCount = openItems.filter((item) => {
    const dueKey = readDateKey(item.dueDate)
    return dueKey !== null && dueKey >= todayKey && dueKey <= dueSoonLimitKey
  }).length

  // 지연 = 마감일이 오늘보다 이전인 미완료 업무. 임박(오늘/3일 이내)과 섞지 않고 따로 집계한다.
  const overdueItems = openItems.filter((item) => {
    const dueKey = readDateKey(item.dueDate)
    return dueKey !== null && dueKey < todayKey
  })
  // 마감 미정 = 진행 중인데 마감일이 없어 일정이 잡히지 않은 업무
  const noDueDateCount = activeItems.filter((item) => readDateKey(item.dueDate) === null).length

  return {
    activeCount: activeItems.length,
    todayWorkCount: todayActiveItems.length,
    weekProgress: weekItems.length > 0 ? Math.round((weekDoneCount / weekItems.length) * 100) : 0,
    weekDoneCount,
    weekTotalCount: weekItems.length,
    dueTodayCount,
    dueSoonCount,
    overdueCount: overdueItems.length,
    weekRemainingCount,
    noDueDateCount,
  }
}

function resolveEventTone(item: WorkItemRecord, dateKey: string): 'due' | 'start' {
  return readDateKey(item.dueDate) === dateKey ? 'due' : 'start'
}

function toTaskRow(item: DashboardWorkItem, accentTone: DashboardTaskAccent): DashboardTaskRow {
  return {
    workItemId: item.workItemId,
    title: item.title,
    nodeTitle: item.nodeTitle,
    status: item.status,
    statusLabel: getWorkItemStatusLabel(item.status),
    startLabel: formatMonthDay(item.startDate),
    dueLabel: formatMonthDay(item.dueDate),
    accentTone,
  }
}

/** 마감이 빠른 순 → 같은 날이면 제목 순. */
function compareByDue(left: WorkItemRecord, right: WorkItemRecord) {
  const leftKey = readDateKey(left.dueDate) ?? '9999-12-31'
  const rightKey = readDateKey(right.dueDate) ?? '9999-12-31'
  return leftKey.localeCompare(rightKey) || left.title.localeCompare(right.title, 'ko')
}

/**
 * 업무 일정 보드 — 한 주(월~일) 기준.
 * 요일마다 그날 시작하거나 마감하는 업무(이벤트)와 그날 걸쳐 있는 진행 중 업무를 나눠 담고,
 * 날짜가 잡히지 않은 지연/마감 미정 업무는 따로 모은다.
 */
export function buildWeekBoard(
  workItems: DashboardWorkItem[],
  weekStart: Date,
  today: Date,
): DashboardWeekBoard {
  const todayKey = toDateKey(today)

  const days: DashboardWeekDay[] = Array.from({ length: WEEK_DAY_COUNT }, (_, index) => {
    const date = addDays(weekStart, index)
    const key = toDateKey(date)

    return {
      key,
      dayLabel: `${date.getMonth() + 1}월 ${date.getDate()}일`,
      weekdayLabel: WEEKDAY_LABELS[date.getDay()],
      isToday: key === todayKey,
      isPast: key < todayKey,
      events: [],
      ongoing: [],
    }
  })

  const eventBuckets: DashboardWorkItem[][] = days.map(() => [])
  const ongoingBuckets: DashboardWorkItem[][] = days.map(() => [])
  const overdue: DashboardWorkItem[] = []
  const unscheduled: DashboardWorkItem[] = []

  workItems
    .filter((item) => !item.isDeleted)
    .forEach((item) => {
      const startKey = readDateKey(item.startDate)
      const dueKey = readDateKey(item.dueDate)

      // 마감일이 없으면 어느 날에도 놓을 수 없어 '마감 미정'으로 모은다.
      if (dueKey === null) {
        if (item.status === 'in-progress') {
          unscheduled.push(item)
        }
        return
      }

      // 아직 끝나지 않았는데 마감일이 지난 업무는 '지연'으로 모은다.
      if (!isDone(item) && dueKey < todayKey) {
        overdue.push(item)
      }

      days.forEach((day, index) => {
        if (day.key === dueKey || day.key === startKey) {
          eventBuckets[index].push(item)
        } else if (startKey !== null && startKey < day.key && day.key < dueKey) {
          ongoingBuckets[index].push(item)
        }
      })
    })

  days.forEach((day, index) => {
    const events = eventBuckets[index]
    const ongoing = ongoingBuckets[index]

    events.sort(
      (left, right) =>
        EVENT_TONE_ORDER[resolveEventTone(left, day.key)] -
          EVENT_TONE_ORDER[resolveEventTone(right, day.key)] ||
        compareByDue(left, right),
    )
    ongoing.sort(compareByDue)

    day.events = events.map((item) => toTaskRow(item, resolveEventTone(item, day.key)))
    day.ongoing = ongoing.map((item) => toTaskRow(item, 'ongoing'))
  })

  overdue.sort(compareByDue)
  unscheduled.sort(compareByDue)

  return {
    days,
    overdue: overdue.map((item) => toTaskRow(item, 'overdue')),
    unscheduled: unscheduled.map((item) => toTaskRow(item, 'unscheduled')),
  }
}

export function buildScheduleCards(
  rules: DashboardRecurringRule[],
  today: Date,
  limit?: number,
): DashboardSchedule[] {
  return rules
    .filter((rule) => rule.isActive && !rule.isDeleted)
    .map((rule) => ({ rule, occurrence: getNextOccurrenceInfo(rule, today) }))
    .filter((entry) => entry.occurrence.nextDate !== null)
    // 다음 발생일이 빠른 순서로 정렬한다.
    .sort((left, right) => {
      const leftTime = left.occurrence.nextDate?.getTime() ?? 0
      const rightTime = right.occurrence.nextDate?.getTime() ?? 0
      return leftTime - rightTime
    })
    .slice(0, limit)
    .map((entry) => ({
      ruleId: entry.rule.ruleId,
      title: entry.rule.title,
      description: entry.rule.description?.trim() ?? '',
      category: entry.rule.category,
      categoryLabel: getRecurringCategoryLabel(entry.rule.category),
      nodeTitle: entry.rule.nodeTitle,
      dateLabel: entry.occurrence.nextDate
        ? SCHEDULE_DATE_FORMATTER.format(entry.occurrence.nextDate)
        : entry.occurrence.dateString,
      repeatLabel: formatRepeatSummary(entry.rule),
    }))
}

/** 좌우 화살표: 보고 있는 주를 한 주씩 이동시킨다. */
export function shiftWeekDateKey(dateKey: string, direction: number) {
  const date = parseDateKey(dateKey) ?? new Date()
  return toDateKey(addDays(date, direction * WEEK_DAY_COUNT))
}