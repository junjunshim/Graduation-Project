import type { IconName } from '../../../design-system/primitives/Icon'
import { sortWorkspaceWorkItems } from '../../workspace/model/sorters'
import type { WorkItemRecord, WorkItemStatus, WorkspaceOverview } from '../../workspace/model/types'
import { getWorkItemStatusLabel } from '../../workspace/model/labels'

export const BOARD_COLUMNS: Array<{
  id: WorkItemStatus
  title: string
}> = [
  { id: 'todo', title: '예정' },
  { id: 'in-progress', title: '진행중' },
  { id: 'done', title: '완료' },
]

export const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']

export type DashboardMetricTone = 'blue' | 'amber' | 'green' | 'neutral'

export type DashboardMetric = {
  label: string
  value: string
  description: string
  icon: IconName
  tone: DashboardMetricTone
}

type ParsedDate = {
  year: number
  monthIndex: number
  day: number
}

export type CalendarCell = {
  key: string
  day: number
  isCurrentMonth: boolean
  isToday: boolean
  holidayName?: string | null
  items: WorkItemRecord[]
}

const LUNAR_HOLIDAYS: Record<number, Record<string, string>> = {
  2024: {
    '02-09': '설날 전날',
    '02-10': '설날',
    '02-11': '설날 다음날',
    '02-12': '대체공휴일 (설날)',
    '05-15': '부처님오신날',
    '09-16': '추석 전날',
    '09-17': '추석',
    '09-18': '추석 다음날',
    '10-01': '국군의 날 (임시공휴일)',
  },
  2025: {
    '01-28': '설날 전날',
    '01-29': '설날',
    '01-30': '설날 다음날',
    '05-05': '어린이날 / 부처님오신날',
    '05-06': '대체공휴일 (부처님오신날)',
    '10-05': '추석 전날',
    '10-06': '추석',
    '10-07': '추석 다음날',
    '10-08': '대체공휴일 (추석)',
  },
  2026: {
    '02-16': '설날 전날',
    '02-17': '설날',
    '02-18': '설날 다음날',
    '03-02': '대체공휴일 (삼일절)',
    '05-24': '부처님오신날',
    '05-25': '대체공휴일 (부처님오신날)',
    '08-17': '대체공휴일 (광복절)',
    '09-24': '추석 전날',
    '09-25': '추석',
    '09-26': '추석 다음날',
    '10-05': '대체공휴일 (개천절)',
  },
  2027: {
    '02-06': '설날 전날',
    '02-07': '설날',
    '02-08': '설날 다음날',
    '02-09': '대체공휴일 (설날)',
    '05-13': '부처님오신날',
    '09-14': '추석 전날',
    '09-15': '추석',
    '09-16': '추석 다음날',
    '10-11': '대체공휴일 (한글날)',
  },
  2028: {
    '01-26': '설날 전날',
    '01-27': '설날',
    '01-28': '설날 다음날',
    '05-02': '부처님오신날',
    '10-02': '추석 전날',
    '10-03': '개천절 / 추석',
    '10-04': '추석 다음날',
    '10-05': '대체공휴일 (추석)',
    '12-26': '대체공휴일 (성탄절)',
  },
}

const SOLAR_FIXED_HOLIDAYS: Record<string, string> = {
  '01-01': '신정 (새해 첫날)',
  '03-01': '삼일절',
  '05-05': '어린이날',
  '06-06': '현충일',
  '08-15': '광복절',
  '10-03': '개천절',
  '10-09': '한글날',
  '12-25': '성탄절',
}

export function getKoreanHolidayName(year: number, month: number, day: number): string | null {
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  const mmdd = `${mm}-${dd}`

  const yearLunar = LUNAR_HOLIDAYS[year]
  if (yearLunar && yearLunar[mmdd]) {
    return yearLunar[mmdd]
  }

  if (SOLAR_FIXED_HOLIDAYS[mmdd]) {
    return SOLAR_FIXED_HOLIDAYS[mmdd]
  }

  if (month === 3 && day === 2) {
    const marchFirst = new Date(year, 2, 1)
    if (marchFirst.getDay() === 0) return '대체공휴일 (삼일절)'
  }
  if (month === 5 && (day === 6 || day === 7)) {
    const may5 = new Date(year, 4, 5)
    if (may5.getDay() === 0 && day === 6) return '대체공휴일 (어린이날)'
    if (may5.getDay() === 6 && day === 7) return '대체공휴일 (어린이날)'
  }
  if (month === 8 && (day === 16 || day === 17)) {
    const aug15 = new Date(year, 7, 15)
    if (aug15.getDay() === 0 && day === 16) return '대체공휴일 (광복절)'
    if (aug15.getDay() === 6 && day === 17) return '대체공휴일 (광복절)'
  }
  if (month === 10 && (day === 4 || day === 5)) {
    const oct3 = new Date(year, 9, 3)
    if (oct3.getDay() === 0 && day === 4) return '대체공휴일 (개천절)'
    if (oct3.getDay() === 6 && day === 5) return '대체공휴일 (개천절)'
  }
  if (month === 10 && (day === 10 || day === 11)) {
    const oct9 = new Date(year, 9, 9)
    if (oct9.getDay() === 0 && day === 10) return '대체공휴일 (한글날)'
    if (oct9.getDay() === 6 && day === 11) return '대체공휴일 (한글날)'
  }

  return null
}

export type DashboardCalendar = {
  monthLabel: string
  cells: CalendarCell[]
  dueItems: WorkItemRecord[]
}

function parseWorkspaceDate(value?: string): ParsedDate | null {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/)

  if (!match) {
    return null
  }

  const [, rawYear, rawMonth, rawDay] = match
  const year = Number(rawYear)
  const monthIndex = Number(rawMonth) - 1
  const day = Number(rawDay)

  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || !Number.isFinite(day)) {
    return null
  }

  return {
    year,
    monthIndex,
    day,
  }
}

export function clampProgress(progress: number) {
  if (!Number.isFinite(progress)) {
    return 0
  }

  return Math.min(100, Math.max(0, Math.round(progress)))
}

export function matchesWorkItemSearch(item: WorkItemRecord, query: string) {
  const normalizedQuery = query.trim().toLowerCase()

  if (!normalizedQuery) {
    return true
  }

  return [item.title, item.workItemId, item.description, getWorkItemStatusLabel(item.status)].some((value) =>
    value.toLowerCase().includes(normalizedQuery),
  )
}

export function buildDashboardCalendar(workItems: WorkItemRecord[], monthOffset = 0): DashboardCalendar {
  const datedWorkItems = sortWorkspaceWorkItems(workItems.filter((item) => parseWorkspaceDate(item.dueDate)))
  const selectedDateParts = parseWorkspaceDate(datedWorkItems[0]?.dueDate)
  const fallbackDate = new Date()
  const baseDate = new Date(
    selectedDateParts?.year ?? fallbackDate.getFullYear(),
    selectedDateParts?.monthIndex ?? fallbackDate.getMonth(),
    1,
  )
  const visibleDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + monthOffset, 1)
  const year = visibleDate.getFullYear()
  const monthIndex = visibleDate.getMonth()
  const today = new Date()
  const firstDay = new Date(year, monthIndex, 1)
  const monthItems = datedWorkItems.filter((item) => {
    const dueDateParts = parseWorkspaceDate(item.dueDate)
    return dueDateParts?.year === year && dueDateParts.monthIndex === monthIndex
  })
  const itemsByDate = new Map<string, WorkItemRecord[]>()

  datedWorkItems.forEach((item) => {
    const dueDateParts = parseWorkspaceDate(item.dueDate)

    if (!dueDateParts) {
      return
    }

    const dateKey = `${dueDateParts.year}-${dueDateParts.monthIndex}-${dueDateParts.day}`
    itemsByDate.set(dateKey, [...(itemsByDate.get(dateKey) ?? []), item])
  })

  const visibleStartDate = new Date(year, monthIndex, 1 - firstDay.getDay())
  const cells: CalendarCell[] = Array.from({ length: 42 }, (_, index) => {
    const cellDate = new Date(visibleStartDate)
    cellDate.setDate(visibleStartDate.getDate() + index)
    const cellYear = cellDate.getFullYear()
    const cellMonthIndex = cellDate.getMonth()
    const day = cellDate.getDate()
    const dateKey = `${cellYear}-${cellMonthIndex}-${day}`

    const holidayName = getKoreanHolidayName(cellYear, cellMonthIndex + 1, day)

    return {
      key: `day-${cellYear}-${cellMonthIndex}-${day}`,
      day,
      isCurrentMonth: cellYear === year && cellMonthIndex === monthIndex,
      isToday: today.getFullYear() === cellYear && today.getMonth() === cellMonthIndex && today.getDate() === day,
      holidayName,
      items: itemsByDate.get(dateKey) ?? [],
    }
  })

  return {
    monthLabel: new Intl.DateTimeFormat('ko-KR', {
      year: 'numeric',
      month: 'long',
    }).format(new Date(year, monthIndex, 1)),
    cells,
    dueItems: monthItems,
  }
}

export function getDueSoonOpenWorkItems(overview: WorkspaceOverview) {
  return overview.dueSoonWorkItems.filter((item) => item.status !== 'done')
}

export function getDashboardMetrics(overview: WorkspaceOverview): DashboardMetric[] {
  // 전체 업무 기준
  const totalInProgressWorkItems = overview.visibleWorkItems.filter(
    (item) => item.status === 'in-progress' || (item.status as string) === 'in_progress',
  )
  const totalDueSoonOpenWorkItems = getDueSoonOpenWorkItems(overview)
  const totalCompletedWorkItems = overview.visibleWorkItems.filter((item) => item.status === 'done')

  // 내 담당 업무(myWorkItems) 기준
  const myInProgressWorkItems = overview.myWorkItems.filter(
    (item) => item.status === 'in-progress' || (item.status as string) === 'in_progress',
  )
  const myDueSoonOpenWorkItems = overview.myWorkItems.filter(
    (item) => item.status !== 'done' && overview.dueSoonWorkItems.some((due) => due.workItemId === item.workItemId),
  )
  const myCompletedWorkItems = overview.myWorkItems.filter((item) => item.status === 'done')

  return [
    {
      label: '워크 스페이스',
      value: String(overview.summary.nodeCount),
      description: '접근 가능한 워크스페이스',
      icon: 'trendingUp',
      tone: 'blue',
    },
    {
      label: '진행 중인 업무',
      value: `${totalInProgressWorkItems.length} / ${myInProgressWorkItems.length}`,
      description: '전체 진행 중 / 내 진행 중',
      icon: 'clock',
      tone: 'neutral',
    },
    {
      label: '마감 임박',
      value: `${totalDueSoonOpenWorkItems.length} / ${myDueSoonOpenWorkItems.length}`,
      description: '전체 마감 임박 / 내 마감 임박',
      icon: 'alertTriangle',
      tone: 'amber',
    },
    {
      label: '완료한 업무',
      value: `${totalCompletedWorkItems.length} / ${myCompletedWorkItems.length}`,
      description: '전체 완료 / 내 완료',
      icon: 'checkCircle',
      tone: 'green',
    },
  ]
}
