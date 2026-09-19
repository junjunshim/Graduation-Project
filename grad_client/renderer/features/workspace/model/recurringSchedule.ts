import { ensureHolidayYears } from './koreanHolidays.js'
import { occursOnCalendarDate } from './recurringCalendar.js'
import type { RecurringRuleRecord } from './recurringRuleTypes'

const WEEKLY_DAY_LABELS: Record<string, string> = {
  MO: '월',
  TU: '화',
  WE: '수',
  TH: '목',
  FR: '금',
  SA: '토',
  SU: '일',
}

const MONTHLY_POSITION_LABELS = ['첫째', '둘째', '셋째', '넷째', '다섯째']

const DAY_MS = 24 * 60 * 60 * 1000

function pad(value: number) {
  return String(value).padStart(2, '0')
}

function formatTimestamp(date: Date, hour: number, minute: number) {
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(hour)}:${pad(minute)}`
}

function parseDayList(value?: string | null) {
  return (value ?? '')
    .split(',')
    .map((day) => day.trim().toUpperCase())
    .filter(Boolean)
}

/** 시간을 제외한 반복 주기 문구 (예: '매주 화요일', '매월 셋째 금요일') */
export function formatRepeatSummary(rule: RecurringRuleRecord): string {
  if (rule.frequency === 'DAILY') {
    return rule.intervalValue === 1 ? '매일' : `${rule.intervalValue}일마다`
  }

  if (rule.frequency === 'WEEKLY') {
    const days = parseDayList(rule.byDay)
      .map((day) => WEEKLY_DAY_LABELS[day] ?? day)
      .join(', ')
    const intervalLabel = rule.intervalValue === 1 ? '매주' : `${rule.intervalValue}주마다`
    return `${intervalLabel} ${days ? `${days}요일` : ''}`.trim()
  }

  if (rule.frequency === 'MONTHLY') {
    const intervalLabel = rule.intervalValue === 1 ? '매월' : `${rule.intervalValue}개월마다`
    const target = rule.bySetPos && rule.byDay
      ? `${rule.bySetPos === -1 ? '마지막' : MONTHLY_POSITION_LABELS[rule.bySetPos - 1] ?? `${rule.bySetPos}번째`} ${
          WEEKLY_DAY_LABELS[parseDayList(rule.byDay)[0]] ?? ''
        }요일`
      : rule.byMonthDay
        ? `${rule.byMonthDay}일`
        : ''
    return `${intervalLabel} ${target}`.trim()
  }

  if (rule.frequency === 'YEARLY') {
    return rule.intervalValue === 1 ? '매년' : `${rule.intervalValue}년마다`
  }

  return rule.frequency
}

/** 반복 주기 + 시작 시각 문구 (예: '매주 화요일 (10:00)') */
export function formatCycleText(rule: RecurringRuleRecord): string {
  const time = rule.startTime ? rule.startTime.slice(0, 5) : ''
  return `${formatRepeatSummary(rule)}${time ? ` (${time})` : ''}`
}

/** 공휴일 순연/조정으로 표시일이 밀릴 수 있는 최대 일수 */
const MAX_HOLIDAY_SHIFT_DAYS = 10

/**
 * 규칙 한 주기 안에서 다음 회차가 나올 수 있는 넉넉한 탐색 범위(일).
 * 공휴일 조정(±10일)과 시작일이 미래인 경우까지 고려한다.
 */
function resolveScanHorizonDays(rule: RecurringRuleRecord) {
  const interval = Math.max(1, Math.trunc(rule.intervalValue) || 1)

  switch (rule.frequency) {
    case 'DAILY':
      return interval + MAX_HOLIDAY_SHIFT_DAYS
    case 'WEEKLY':
      return interval * 7 + 7 + MAX_HOLIDAY_SHIFT_DAYS
    case 'MONTHLY':
      return interval * 31 + 31 + MAX_HOLIDAY_SHIFT_DAYS
    case 'YEARLY':
      return interval * 366 + 366 + MAX_HOLIDAY_SHIFT_DAYS
    default:
      return 366 + MAX_HOLIDAY_SHIFT_DAYS
  }
}

function parseLocalDate(value?: string | null) {
  const parts = value ? value.split('-').map(Number) : []
  if (parts.length !== 3 || !parts.every((part) => Number.isFinite(part))) return null

  return new Date(parts[0], parts[1] - 1, parts[2])
}

function toLocalDateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * 오늘을 기준으로 다음 발생 일시(Next Occurrence) 및 D-Day 계산.
 *
 * 달력(occursOnCalendarDate)과 동일하게 규칙의 공휴일 정책(제외/다음 영업일/이전 영업일)을
 * 적용한 '실제 표시일'을 기준으로 찾는다.
 */
export function getNextOccurrenceInfo(
  rule: RecurringRuleRecord,
  now: Date = new Date(),
): {
  nextDate: Date | null
  dDay: number | null
  dateString: string
} {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const [hour, minute] = rule.startTime ? rule.startTime.split(':').map(Number) : [9, 0]

  const startDate = parseLocalDate(rule.repeatStartDate)
  const endDate = parseLocalDate(rule.repeatEndDate)

  const daysUntilStart = startDate
    ? Math.max(0, Math.round((startDate.getTime() - today.getTime()) / DAY_MS))
    : 0
  const horizonDays = daysUntilStart + resolveScanHorizonDays(rule)

  // 공휴일 데이터는 비동기로 적재되므로, 탐색 범위에 걸치는 연도를 미리 요청해 둔다.
  // (시작일이 아주 먼 미래여도 초기 렌더가 느려지지 않도록 최대 4년까지만 요청한다)
  const horizonYear = new Date(today.getFullYear(), today.getMonth(), today.getDate() + horizonDays).getFullYear()
  const lastPrefetchYear = Math.min(horizonYear, today.getFullYear() + 3)
  const prefetchYears: number[] = []
  for (let year = today.getFullYear(); year <= lastPrefetchYear; year += 1) {
    prefetchYears.push(year)
  }
  void ensureHolidayYears(prefetchYears)

  for (let offset = 0; offset <= horizonDays; offset += 1) {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset)

    // 종료일 이후로도 공휴일 순연만큼은 표시될 수 있다.
    if (endDate && date.getTime() > endDate.getTime() + MAX_HOLIDAY_SHIFT_DAYS * DAY_MS) break
    if (!occursOnCalendarDate(rule, toLocalDateKey(date))) continue

    const candidate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0)
    if (candidate < now) continue

    const dDay = Math.round((date.getTime() - today.getTime()) / DAY_MS)
    return { nextDate: candidate, dDay, dateString: formatTimestamp(candidate, hour, minute) }
  }

  if (endDate && today > endDate) {
    return { nextDate: null, dDay: null, dateString: '종료됨' }
  }

  return { nextDate: null, dDay: null, dateString: '예정 없음' }
}