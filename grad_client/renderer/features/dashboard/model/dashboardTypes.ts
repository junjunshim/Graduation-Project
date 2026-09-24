import type { RecurringCategory, RecurringRuleRecord } from '../../workspace/model/recurringRuleTypes'
import type { WorkItemRecord, WorkItemStatus } from '../../workspace/model/types'

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

export type DashboardWorkItem = WorkItemRecord & {
  /** 업무가 속한 노드 이름 (없으면 null) */
  nodeTitle: string | null
}

export type DashboardRecurringRule = RecurringRuleRecord & {
  /** 일정이 속한 노드 이름 (없으면 null) */
  nodeTitle: string | null
}

export type DashboardContext = {
  viewer: DashboardViewer | null
  /** 담당자가 나인 업무 (서버 기준 최근 6개월) */
  workItems: DashboardWorkItem[]
  /** 스코프 안의 정기 일정 */
  recurringRules: DashboardRecurringRule[]
}

export type DashboardMetrics = {
  /** 진행 중인 업무 건수 */
  activeCount: number
  /** 진행 중인 업무 중 오늘 날짜가 업무 기간(일자~마감)에 포함된 건수 */
  todayWorkCount: number
  /** 이번 주에 마감해야 하는 업무 대비 완료 비율(%) */
  weekProgress: number
  /** 이번 주 마감 업무 중 완료된 건수 */
  weekDoneCount: number
  /** 이번 주에 마감일이 있는 업무 건수 */
  weekTotalCount: number
  /** 오늘 마감이며 아직 끝나지 않은 업무 건수 */
  dueTodayCount: number
  /** 3일 이내 마감이며 아직 끝나지 않은 업무 건수 (임박한 앞으로의 마감) */
  dueSoonCount: number
  /** 마감일이 이미 지난 미완료 업무 건수 (지연) */
  overdueCount: number
  /** 이번 주에 마감이며 아직 끝나지 않은 업무 건수 */
  weekRemainingCount: number
  /** 진행 중인데 마감일이 없는 업무 건수 */
  noDueDateCount: number
}

/** 그날 업무가 어떤 관계인지 (왼쪽 색상 바에 사용) */
export type DashboardTaskAccent = 'start' | 'ongoing' | 'due' | 'overdue' | 'unscheduled'

export type DashboardTaskRow = {
  workItemId: string
  title: string
  /** 업무가 속한 노드(워크스페이스) 이름 */
  nodeTitle: string | null
  status: WorkItemStatus
  statusLabel: string
  startLabel: string | null
  dueLabel: string | null
  accentTone: DashboardTaskAccent
}

/** 한 주의 하루 — 그날 시작/마감하는 업무(이벤트)와 그날 걸쳐 있는 진행 중 업무를 나눠 담는다. */
export type DashboardWeekDay = {
  key: string
  /** '9월 15일' */
  dayLabel: string
  /** '월' */
  weekdayLabel: string
  isToday: boolean
  isPast: boolean
  /** 그날 시작하거나 마감하는 업무 */
  events: DashboardTaskRow[]
  /** 그날이 업무 기간 안에 있는 진행 중 업무 */
  ongoing: DashboardTaskRow[]
}

/** 한 주 업무 일정 보드 (월~일) */
export type DashboardWeekBoard = {
  days: DashboardWeekDay[]
  /** 마감일이 지난 미완료 업무 (오늘 기준) */
  overdue: DashboardTaskRow[]
  /** 마감일이 없어 일정이 잡히지 않은 진행 중 업무 */
  unscheduled: DashboardTaskRow[]
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
  /** 카테고리 뱃지 라벨 (예: '정기 회의') */
  categoryLabel: string
  /** 일정이 속한 노드(워크스페이스) 이름 */
  nodeTitle: string | null
  dateLabel: string
  repeatLabel: string
}