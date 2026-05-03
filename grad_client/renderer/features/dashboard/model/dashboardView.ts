import type { IconName } from '../../../design-system/primitives/Icon'
import { sortWorkspaceWorkItems } from '../../workspace/model/sorters'
import type { WorkItemRecord, WorkItemStatus, WorkspaceOverview } from '../../workspace/model/types'
import { getWorkItemStatusLabel } from '../../workspace/model/labels'

export const BOARD_COLUMNS: Array<{
  id: WorkItemStatus
  title: string
  description: string
}> = [
  { id: 'in-progress', title: '진행 중', description: '오늘 이어서 볼 업무' },
  { id: 'todo', title: '대기', description: '착수 전 확인 항목' },
  { id: 'done', title: '완료', description: '최근 완료된 업무' },
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

export type CalendarCell =
  | {
      type: 'empty'
      key: string
    }
  | {
      type: 'day'
      key: string
      day: number
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

export function buildDashboardCalendar(workItems: WorkItemRecord[]): DashboardCalendar {
  const datedWorkItems = sortWorkspaceWorkItems(workItems.filter((item) => parseWorkspaceDate(item.dueDate)))
  const selectedDateParts = parseWorkspaceDate(datedWorkItems[0]?.dueDate)
  const fallbackDate = new Date()
  const year = selectedDateParts?.year ?? fallbackDate.getFullYear()
  const monthIndex = selectedDateParts?.monthIndex ?? fallbackDate.getMonth()
  const today = new Date()
  const firstDay = new Date(year, monthIndex, 1)
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate()
  const monthItems = datedWorkItems.filter((item) => {
    const dueDateParts = parseWorkspaceDate(item.dueDate)
    return dueDateParts?.year === year && dueDateParts.monthIndex === monthIndex
  })
  const itemsByDay = new Map<number, WorkItemRecord[]>()

  monthItems.forEach((item) => {
    const dueDateParts = parseWorkspaceDate(item.dueDate)

    if (!dueDateParts) {
      return
    }

    itemsByDay.set(dueDateParts.day, [...(itemsByDay.get(dueDateParts.day) ?? []), item])
  })

  const cells: CalendarCell[] = Array.from({ length: firstDay.getDay() }, (_, index) => ({
    type: 'empty',
    key: `empty-${index}`,
  }))

  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({
      type: 'day',
      key: `day-${day}`,
      day,
      isToday: today.getFullYear() === year && today.getMonth() === monthIndex && today.getDate() === day,
      items: itemsByDay.get(day) ?? [],
    })
  }

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
  const activeWorkItems = overview.visibleWorkItems.filter((item) => item.status === 'in-progress')
  const completedWorkItems = overview.visibleWorkItems.filter((item) => item.status === 'done')
  const dueSoonOpenWorkItems = getDueSoonOpenWorkItems(overview)

  return [
    {
      label: '진행 중인 업무',
      value: String(activeWorkItems.length),
      description: '현재 실행 중인 항목',
      icon: 'trendingUp',
      tone: 'blue',
    },
    {
      label: '마감 임박',
      value: String(dueSoonOpenWorkItems.length),
      description: '7일 이내 확인 필요',
      icon: 'alertTriangle',
      tone: 'amber',
    },
    {
      label: '완료 업무',
      value: String(completedWorkItems.length),
      description: '완료 처리된 항목',
      icon: 'checkCircle',
      tone: 'green',
    },
    {
      label: '평균 진행률',
      value: `${overview.summary.averageProgress}%`,
      description: '전체 업무 기준 평균',
      icon: 'sparkles',
      tone: 'neutral',
    },
  ]
}
