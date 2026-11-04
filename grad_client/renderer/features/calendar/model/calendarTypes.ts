import type { WorkItemStatus } from '../../workspace/model/types'

/** 캘린더 상단 구분 필터 ('전체' | '업무' | '일정') */
export type CalendarFilterEntryType = 'all' | 'work' | 'schedule'

/** 캘린더 칩 색상 톤 (CSS data-tone 과 1:1) */
export type CalendarChipTone = 'brand' | 'info' | 'success' | 'warning' | 'danger' | 'muted'

/** 칩이 무엇을 가리키는지 — 정기 일정이거나, 업무의 시작/마감 이벤트다. */
export type CalendarChipKind = 'schedule' | 'start' | 'due'

/** 그날 걸쳐 있는 업무 */
export type CalendarOngoingKind = 'ongoing'

/** 업무 칩/진행 중 항목이 가리키는 업무 관계 */
export type CalendarWorkItemReason = 'start' | 'due' | 'ongoing'

/** 드로어에서 열 수 있는 항목 종류 */
export type CalendarEntryKind = CalendarChipKind | CalendarOngoingKind

export type CalendarChip = {
  /** 같은 날 중복을 피하기 위한 키 (schedule-3, due-WI-1) */
  key: string
  kind: CalendarChipKind
  title: string
  /** '10:30' — 일정에 시작 시간이 있을 때만 */
  timeLabel: string | null
  tone: CalendarChipTone
  /** 업무 시작/마감 칩의 상태 반영 라벨 ('마감', '시작', '예정·마감', '예정·시작', '완료·마감', '완료·시작') */
  kindLabel?: string
  /** 업무 칩의 현재 상태 */
  workItemStatus?: WorkItemStatus
  /** 업무 칩이면 업무 id */
  workItemId?: string
  /** 정기 일정 칩이면 규칙 id */
  ruleId?: number
}

export type CalendarOngoingItem = {
  key: string
  kind: CalendarOngoingKind
  title: string
  tone: CalendarChipTone
  workItemId: string
  workItemStatus: WorkItemStatus
  statusLabel: string
}

export type CalendarDayCell = {
  /** 'YYYY-MM-DD' */
  key: string
  dayNumber: number
  /** 보고 있는 달의 날짜인지 (아니면 흐리게) */
  isCurrentMonth: boolean
  isToday: boolean
  isSunday: boolean
  isSaturday: boolean
  /** 법정 공휴일 명칭 (공휴일이 아니면 null) */
  holiday: string | null
  /** 그날 시작하거나 마감하는 업무 */
  events: CalendarChip[]
  /** 그날 발생하는 정기 일정 (전부 표시) */
  schedules: CalendarChip[]
  /** 그날 걸쳐 있는 업무 (기본은 건수만, 펼치면 목록) */
  ongoing: CalendarOngoingItem[]
}

/** '업무' 필터 전용 주간 연속 기간 바 */
export type CalendarWeekSpanBar = {
  key: string
  workItemId: string
  title: string
  workItemStatus: WorkItemStatus
  statusLabel: string
  tone: CalendarChipTone
  /** 1 ~ 7 (일요일=1 ~ 토요일=7) */
  startCol: number
  /** 1 ~ 7 */
  endCol: number
  /** endCol - startCol + 1 */
  spanCols: number
  /** 0부터 시작하는 수직 레인 인덱스 */
  lane: number
  /** 이전 주에서 이어지는지 여부 */
  continuesFromPrev: boolean
  /** 다음 주로 이어지는지 여부 */
  continuesToNext: boolean
  /** 이 주에서 시작하는 날짜 키 ('YYYY-MM-DD') */
  startDateKey: string
  /** 마감 지연 여부 */
  isOverdue: boolean
}

/** '업무' 필터 전용 1주(7일) 행 모델 */
export type CalendarWeekRow = {
  weekKey: string
  cells: CalendarDayCell[]
  spanBars: CalendarWeekSpanBar[]
  maxLaneCount: number
}

/** 상세 드로어에서 무엇을 열었는지 */
export type CalendarSelection =
  | { kind: 'workItem'; workItemId: string; reason: CalendarWorkItemReason; dateKey: string }
  | { kind: 'schedule'; ruleId: number; dateKey: string }
