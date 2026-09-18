/** 캘린더 칩 색상 톤 (CSS data-tone 과 1:1) */
export type CalendarChipTone = 'brand' | 'info' | 'success' | 'warning' | 'danger' | 'muted'

/** 칩이 무엇을 가리키는지 — 정기 일정이거나, 업무의 시작/마감 이벤트다. */
export type CalendarChipKind = 'schedule' | 'start' | 'due'

/** 그날 걸쳐 있는 진행 중 업무 */
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
  /** 그날 시작하거나 마감하는 업무 */
  events: CalendarChip[]
  /** 그날 발생하는 정기 일정 (전부 표시) */
  schedules: CalendarChip[]
  /** 그날 걸쳐 있는 진행 중 업무 (기본은 건수만, 펼치면 목록) */
  ongoing: CalendarOngoingItem[]
}

/** 상세 드로어에서 무엇을 열었는지 */
export type CalendarSelection =
  | { kind: 'workItem'; workItemId: string; reason: CalendarWorkItemReason; dateKey: string }
  | { kind: 'schedule'; ruleId: number; dateKey: string }
