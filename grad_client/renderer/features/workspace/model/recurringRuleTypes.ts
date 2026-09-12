export type RecurringCategory = 'ROUTINE' | 'REPORT' | 'INSPECTION' | 'MEETING' | 'EVENT'

export type RecurringFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'

export type HolidayAction = 'SKIP' | 'NEXT_WORKDAY' | 'PREV_WORKDAY'

export type RecurringWeekDay = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU'

export interface RecurringChecklistItem {
  checklistId?: number
  ruleId?: number
  content: string
  sortOrder: number
  createdAt?: string
}

export interface RecurringRuleFileRecord {
  fileId: number
  ruleId: number
  uploaderUserId: string
  originalFileName: string
  storedFileName: string
  filePath: string
  fileSize: number
  mimeType?: string | null
  isDeleted?: boolean
  createdAt: string
  updatedAt?: string
}

export interface RecurringRuleRecord {
  ruleId: number
  ownerNodeId: number
  creatorUserId: string
  assigneeUserId?: string | null
  title: string
  description?: string | null
  category: RecurringCategory

  // 반복 주기 속성
  frequency: RecurringFrequency
  intervalValue: number // N일/N주/N개월 주기 (기본: 1)
  byDay?: string | null // 'MO,TU,WE' 등
  byMonthDay?: number | null // 월간 일자 (1~31)
  bySetPos?: number | null // 주차 (1: 첫째주, -1: 마지막주 등)

  // 시간 및 유효 기간
  startTime?: string | null // 'HH:MM:SS' 또는 'HH:MM'
  durationMinutes?: number | null // 소요 시간 (분)
  repeatStartDate: string // 'YYYY-MM-DD'
  repeatEndDate?: string | null // 'YYYY-MM-DD' (null: 무기한)
  maxOccurrences?: number | null

  // 공휴일 처리 정책
  excludeHolidays: boolean
  holidayAction: HolidayAction

  // 자동 생성 플래그
  autoCreateTask: boolean

  isActive: boolean
  isDeleted?: boolean
  createdAt: string
  updatedAt?: string

  // 관계 데이터 (조회 시 동봉)
  checklists?: RecurringChecklistItem[]
  files?: RecurringRuleFileRecord[]
}

export interface CreateRecurringRuleRequest {
  ownerNodeId: number
  title: string
  description?: string
  category: RecurringCategory
  assigneeUserId?: string

  frequency: RecurringFrequency
  intervalValue: number
  byDay?: string
  byMonthDay?: number
  bySetPos?: number

  startTime?: string
  durationMinutes?: number
  repeatStartDate: string
  repeatEndDate?: string
  maxOccurrences?: number

  excludeHolidays: boolean
  holidayAction: HolidayAction
  autoCreateTask?: boolean

  checklists?: Array<{ content: string; sortOrder: number }>
}

export interface UpdateRecurringRuleRequest {
  ruleId: number
  title?: string
  description?: string
  category?: RecurringCategory
  assigneeUserId?: string | null

  frequency?: RecurringFrequency
  intervalValue?: number
  byDay?: string | null
  byMonthDay?: number | null
  bySetPos?: number | null

  startTime?: string | null
  durationMinutes?: number | null
  repeatStartDate?: string
  repeatEndDate?: string | null
  maxOccurrences?: number | null

  excludeHolidays?: boolean
  holidayAction?: HolidayAction
  autoCreateTask?: boolean
  isActive?: boolean

  checklists?: Array<{ content: string; sortOrder: number }>
}
