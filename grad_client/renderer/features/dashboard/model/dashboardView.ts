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
  items: WorkItemRecord[]
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

    return {
      key: `day-${cellYear}-${cellMonthIndex}-${day}`,
      day,
      isCurrentMonth: cellYear === year && cellMonthIndex === monthIndex,
      isToday: today.getFullYear() === cellYear && today.getMonth() === cellMonthIndex && today.getDate() === day,
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
      value: String(overview.summary.orgNodeCount),
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
