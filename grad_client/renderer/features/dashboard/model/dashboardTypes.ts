import type { RecurringCategory, RecurringRuleRecord } from '../../workspace/model/recurringRuleTypes'
import type { WorkItemRecord, WorkItemStatus } from '../../workspace/model/types'

export type DashboardSource = 'mock' | 'server'

export type DashboardViewer = {
  userId: string
  email: string
  name: string
  role: string | null
  nodeId: number | null
  nodeTitle: string | null
  today: string | null
  weekStartDate: string | null
  weekEndDate: string | null
}

export type DashboardContext = {
  source: DashboardSource
  viewer: DashboardViewer | null
  /** 담당자가 나인 업무 (서버 기준 최근 6개월) */
  workItems: WorkItemRecord[]
  /** 스코프 안의 정기 일정 */
  recurringRules: RecurringRuleRecord[]
}

export type DashboardNearestDue = {
  workItemId: string
  title: string
  dateLabel: string
}

export type DashboardMetrics = {
  /** 진행 중인 업무 건수 */
  activeCount: number
  /** 오늘 시작하거나 오늘 마감인 업무 건수 */
  todayWorkCount: number
  /** 이번 주 업무 대비 완료 비율(%) */
  weekProgress: number
  weekDoneCount: number
  weekTotalCount: number
  /** 오늘 마감이며 아직 끝나지 않은 업무 건수 */
  dueTodayCount: number
  /** 3일 이내 마감이며 아직 끝나지 않은 업무 건수 */
  dueSoonCount: number
  nearestDue: DashboardNearestDue | null
}

/** 선택한 날짜를 기준으로 한 업무 관계 (왼쪽 색상 바에 사용) */
export type DashboardTaskAccent = 'start' | 'ongoing' | 'due'

export type DashboardTaskRow = {
  workItemId: string
  title: string
  status: WorkItemStatus
  statusLabel: string
  startLabel: string | null
  dueLabel: string | null
  accentTone: DashboardTaskAccent
}

export type DashboardCalendarDay = {
  key: string
  dayLabel: string
  weekdayLabel: string
  isToday: boolean
  /** 고를 수 있는 범위(오늘 기준 ±6개월) 안의 날짜인지 */
  isSelectable: boolean
  dotCount: number
}

/** 업무 일정에서 고를 수 있는 날짜 범위 */
export type DashboardDateRange = {
  minDateKey: string
  maxDateKey: string
}

export type DashboardSchedule = {
  ruleId: number
  title: string
  description: string
  category: RecurringCategory
  badgeLabel: string
  dateLabel: string
  repeatLabel: string
}

export type DashboardWindow = {
  start: Date
  end: Date
}