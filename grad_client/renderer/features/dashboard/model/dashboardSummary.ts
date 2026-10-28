import { formatWorkspaceMonthDay } from '../../workspace/model/formatters'
import { getRecurringCategoryLabel, getWorkItemStatusLabel } from '../../workspace/model/labels'
import { formatRepeatSummary, getNextOccurrenceInfo } from '../../workspace/model/recurringSchedule'
import type { WorkItemRecord } from '../../workspace/model/types'
import { getWorkItemTag } from '../../workspace/model/workItemTags'
import type { DashboardRecurringRule, DashboardWorkItem } from './dashboardTypes'
import type {
  DashboardActivityChartSeries,
  DashboardChartPeriod,
  DashboardDateRange,
  DashboardMetrics,
  DashboardSchedule,
  DashboardTableTaskRow,
  DashboardTaskAccent,
  DashboardTaskFilter,
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

/** 시안 스타일의 '10.12 – 10.18' 주간 점 표기 라벨 */
export function formatWeekDotRangeLabel(startKey: string, endKey: string) {
  const start = parseDateKey(startKey)
  const end = parseDateKey(endKey)

  if (!start || !end) {
    return `${startKey} – ${endKey}`
  }

  return `${pad(start.getMonth() + 1)}.${pad(start.getDate())} – ${pad(end.getMonth() + 1)}.${pad(end.getDate())}`
}

function formatMonthDay(value?: string) {
  const dateKey = readDateKey(value)
  return dateKey ? formatWorkspaceMonthDay(dateKey) : null
}

function formatShortDotDate(value?: string) {
  const dateKey = readDateKey(value)
  if (!dateKey) return '미정'
  const parsed = parseDateKey(dateKey)
  if (!parsed) return '미정'
  return `${pad(parsed.getMonth() + 1)}.${pad(parsed.getDate())}`
}

/** 업무가 차지하는 기간(일자~마감). 한쪽만 있으면 그 날짜 하루로 본다. */
function getWorkItemRange(item: WorkItemRecord) {
  const rawStart = readDateKey(item.startDate) ?? readDateKey(item.dueDate) ?? readDateKey(item.createdAt)
  const rawDue = readDateKey(item.dueDate) ?? readDateKey(item.startDate) ?? readDateKey(item.createdAt)

  if (rawStart && rawDue && rawStart > rawDue) {
    return { startKey: rawDue, dueKey: rawStart }
  }

  return { startKey: rawStart, dueKey: rawDue }
}

/** 업무 기간(일자~마감)에 해당 날짜가 포함되는지. 업무 일정 패널에 보이는 기준과 같다. */
function isWorkItemOnDate(item: WorkItemRecord, dateKey: string) {
  if (item.isDeleted) {
    return false
  }

  const { startKey, dueKey } = getWorkItemRange(item)

  return startKey !== null && dueKey !== null && startKey <= dateKey && dueKey >= dateKey
}

/** 업무 기간이 [rangeStartKey, rangeEndKey] 구간과 겹치는지 확인한다. */
function isWorkItemOverlappingRange(item: WorkItemRecord, rangeStartKey: string, rangeEndKey: string) {
  if (item.isDeleted) {
    return false
  }

  const { startKey, dueKey } = getWorkItemRange(item)
  if (!startKey || !dueKey) {
    return false
  }

  return startKey <= rangeEndKey && dueKey >= rangeStartKey
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

function buildYTicks(values: number[]): number[] {
  const maxVal = Math.max(0, ...values)
  const step = Math.max(4, Math.ceil(maxVal / 3 / 2) * 2)
  return [0, step, step * 2, step * 3]
}

/**
 * 대시보드 상단 우측 '업무 활동' 라인 차트 데이터를 기간 탭('1d' | '1w' | '1m' | '6m')에 맞춰 생성한다.
 * 모든 기간 탭에서 두 개 꺾은선은 일관되게 '진행 중'(in-progress) vs '완료'(done) 업무 건수를 표시한다.
 */
export function buildActivityChartSeries(
  workItems: DashboardWorkItem[],
  today: Date,
  period: DashboardChartPeriod,
): DashboardActivityChartSeries {
  const visibleItems = workItems.filter((item) => !item.isDeleted)

  if (period === '1d') {
    // 최근 7일(D-6 ~ 오늘) 일별 진행 중 vs 완료 추이
    const days = Array.from({ length: 7 }, (_, index) => addDays(today, -(6 - index)))
    const labels = days.map((date, index) =>
      index === 6 ? '오늘' : `${pad(date.getMonth() + 1)}.${pad(date.getDate())}`,
    )

    const currentValues: number[] = []
    const previousValues: number[] = []

    days.forEach((date) => {
      const dateKey = toDateKey(date)
      const onDateItems = visibleItems.filter((item) => isWorkItemOnDate(item, dateKey))
      currentValues.push(onDateItems.filter((item) => item.status === 'in-progress').length)
      previousValues.push(onDateItems.filter((item) => item.status === 'done').length)
    })

    return {
      period,
      title: '일간 업무 활동',
      currentLabel: '진행 중',
      previousLabel: '완료',
      labels,
      currentValues,
      previousValues,
      yTicks: buildYTicks([...currentValues, ...previousValues]),
    }
  }

  if (period === '1m') {
    const labels = ['1주', '2주', '3주', '4주', '5주']
    const year = today.getFullYear()
    const month = today.getMonth()
    const lastDay = new Date(year, month + 1, 0).getDate()

    const currentValues: number[] = []
    const previousValues: number[] = []

    for (let weekIndex = 0; weekIndex < 5; weekIndex += 1) {
      const startDay = weekIndex * 7 + 1
      if (startDay > lastDay) {
        currentValues.push(0)
        previousValues.push(0)
        continue
      }
      const endDay = Math.min(lastDay, (weekIndex + 1) * 7)
      const rangeStart = toDateKey(new Date(year, month, startDay))
      const rangeEnd = toDateKey(new Date(year, month, endDay))
      const overlapping = visibleItems.filter((item) =>
        isWorkItemOverlappingRange(item, rangeStart, rangeEnd),
      )
      currentValues.push(overlapping.filter((item) => item.status === 'in-progress').length)
      previousValues.push(overlapping.filter((item) => item.status === 'done').length)
    }

    return {
      period,
      title: '월간 업무 활동',
      currentLabel: '진행 중',
      previousLabel: '완료',
      labels,
      currentValues,
      previousValues,
      yTicks: buildYTicks([...currentValues, ...previousValues]),
    }
  }

  if (period === '6m') {
    const months = Array.from({ length: 6 }, (_, index) => addMonths(today, -(5 - index)))
    const labels = months.map((date) => `${date.getMonth() + 1}월`)

    const currentValues: number[] = []
    const previousValues: number[] = []

    months.forEach((monthDate) => {
      const year = monthDate.getFullYear()
      const month = monthDate.getMonth()
      const lastDay = new Date(year, month + 1, 0).getDate()
      const rangeStart = toDateKey(new Date(year, month, 1))
      const rangeEnd = toDateKey(new Date(year, month, lastDay))

      const overlapping = visibleItems.filter((item) =>
        isWorkItemOverlappingRange(item, rangeStart, rangeEnd),
      )
      currentValues.push(overlapping.filter((item) => item.status === 'in-progress').length)
      previousValues.push(overlapping.filter((item) => item.status === 'done').length)
    })

    return {
      period,
      title: '6개월 업무 추이',
      currentLabel: '진행 중',
      previousLabel: '완료',
      labels,
      currentValues,
      previousValues,
      yTicks: buildYTicks([...currentValues, ...previousValues]),
    }
  }

  // 기본: '1w' (이번 주 월~일 요일별 진행 중 vs 완료 업무 수)
  const labels = ['월', '화', '수', '목', '금', '토', '일']
  const thisWeek = getWeekWindow(today)

  const currentValues: number[] = []
  const previousValues: number[] = []

  for (let index = 0; index < 7; index += 1) {
    const dateKey = toDateKey(addDays(thisWeek.start, index))
    const onDateItems = visibleItems.filter((item) => isWorkItemOnDate(item, dateKey))
    currentValues.push(onDateItems.filter((item) => item.status === 'in-progress').length)
    previousValues.push(onDateItems.filter((item) => item.status === 'done').length)
  }

  return {
    period: '1w',
    title: '주간 업무 활동',
    currentLabel: '진행 중',
    previousLabel: '완료',
    labels,
    currentValues,
    previousValues,
    yTicks: buildYTicks([...currentValues, ...previousValues]),
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
 * 업무 일정 테이블용 행 리스트 빌더.
 * 보고 있는 주(weekStart ~ weekEnd)에 기간이 걸치거나 해당 주에 시작/마감하는 업무를 중복 없이 반환한다.
 * 필터가 'overdue' 또는 'unscheduled'일 때는 전체 지연/마감미정 업무도 함께 보여준다.
 */
export function buildWeekTaskTableRows(
  workItems: DashboardWorkItem[],
  weekStart: Date,
  today: Date,
  filter: DashboardTaskFilter = 'all',
): DashboardTableTaskRow[] {
  const todayKey = toDateKey(today)
  const weekStartKey = toDateKey(weekStart)
  const weekEndKey = toDateKey(addDays(weekStart, 6))

  const statusOrder: Record<WorkItemRecord['status'], number> = {
    'in-progress': 0,
    todo: 1,
    done: 2,
  }

  return workItems
    .filter((item) => !item.isDeleted)
    .filter((item) => {
      const startKey = readDateKey(item.startDate)
      const dueKey = readDateKey(item.dueDate)
      const isOverdue = item.status !== 'done' && dueKey !== null && dueKey < todayKey
      const isUnscheduled = dueKey === null

      if (filter === 'overdue') {
        return isOverdue
      }
      if (filter === 'unscheduled') {
        return isUnscheduled && item.status !== 'done'
      }
      if (filter === 'in-progress' && item.status !== 'in-progress') {
        return false
      }
      if (filter === 'todo' && item.status !== 'todo') {
        return false
      }
      if (filter === 'done' && item.status !== 'done') {
        return false
      }

      // 주간 범위에 걸치거나 시작/마감일이 주간에 포함되는 업무
      const rawStart = startKey ?? dueKey
      const rawEnd = dueKey ?? startKey
      if (!rawStart || !rawEnd) {
        return false
      }
      const itemStart = rawStart <= rawEnd ? rawStart : rawEnd
      const itemEnd = rawStart <= rawEnd ? rawEnd : rawStart
      return itemStart <= weekEndKey && itemEnd >= weekStartKey
    })
    .sort((left, right) => {
      const statusDiff = statusOrder[left.status] - statusOrder[right.status]
      if (statusDiff !== 0) return statusDiff
      return compareByDue(left, right)
    })
    .map((item) => {
      const dueKey = readDateKey(item.dueDate)
      const tag = getWorkItemTag(item)
      const categoryLabel = tag?.label ?? (item.category?.trim() || '일반 업무')
      const isOverdue = item.status !== 'done' && dueKey !== null && dueKey < todayKey
      const isUnscheduled = dueKey === null
      const isDueToday = dueKey === todayKey

      return {
        workItemId: item.workItemId,
        title: item.title,
        categoryLabel,
        nodeId: item.ownerNodeId,
        nodeTitle: item.nodeTitle?.trim() || '개인 워크스페이스',
        status: item.status,
        statusLabel: isOverdue ? '지연' : item.status === 'todo' ? '대기' : getWorkItemStatusLabel(item.status),
        dueDateShort: formatShortDotDate(item.dueDate),
        isOverdue,
        isUnscheduled,
        isDueToday,
      }
    })
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

function formatRuleTimeRange(startTime?: string | null, durationMinutes?: number | null): string {
  const match = startTime?.match(/^(\d{1,2}):(\d{2})/)
  const startLabel = match ? `${match[1].padStart(2, '0')}:${match[2]}` : '09:00'
  const duration = durationMinutes && durationMinutes > 0 ? durationMinutes : 60
  const [hour, minute] = startLabel.split(':').map(Number)
  const endTotal = hour * 60 + minute + duration
  const endHour = Math.floor(endTotal / 60) % 24
  const endMinute = endTotal % 60
  return `${startLabel} – ${pad(endHour)}:${pad(endMinute)}`
}

export function buildScheduleCards(
  rules: DashboardRecurringRule[],
  today: Date,
  limit?: number,
): DashboardSchedule[] {
  const todayKey = toDateKey(today)

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
    .map((entry) => {
      const nextDate = entry.occurrence.nextDate ?? today
      const nextDateKey = toDateKey(nextDate)
      const isToday = nextDateKey === todayKey
      const monthDayLabel = `${pad(nextDate.getMonth() + 1)}.${pad(nextDate.getDate())}`
      const monthShort = `${nextDate.getMonth() + 1}월`
      const dayNumber = String(nextDate.getDate())
      const weekdayShort = WEEKDAY_LABELS[nextDate.getDay()]
      const rangeText = formatRuleTimeRange(entry.rule.startTime, entry.rule.durationMinutes)
      const timeRangeLabel = isToday ? `오늘 ${rangeText}` : `${monthDayLabel} · ${rangeText}`

      return {
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
        monthDayLabel,
        monthShort,
        dayNumber,
        weekdayShort,
        isToday,
        timeRangeLabel,
      }
    })
}

/** 좌우 화살표: 보고 있는 주를 한 주씩 이동시킨다. */
export function shiftWeekDateKey(dateKey: string, direction: number) {
  const date = parseDateKey(dateKey) ?? new Date()
  return toDateKey(addDays(date, direction * WEEK_DAY_COUNT))
}