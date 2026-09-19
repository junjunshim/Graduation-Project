import { isHolidayDate, isWorkdayDate } from './koreanHolidays.js'
import type { HolidayAction, RecurringRuleRecord } from './recurringRuleTypes'

const DAY_MS = 86400000
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

/** 공휴일 순연/조정 시 옮겨볼 수 있는 최대 일수 (연휴 + 주말을 넉넉히 덮는다) */
const MAX_HOLIDAY_SHIFT_DAYS = 10

function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null
}

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

function shiftDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS)
}

function matchesDate(rule: RecurringRuleRecord, start: Date, date: Date): boolean {
  const interval = Math.max(1, Math.trunc(rule.intervalValue) || 1)
  const elapsedDays = Math.round((date.getTime() - start.getTime()) / DAY_MS)
  const monthOffset = (date.getUTCFullYear() - start.getUTCFullYear()) * 12 + date.getUTCMonth() - start.getUTCMonth()
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()

  switch (rule.frequency) {
    case 'DAILY':
      return elapsedDays % interval === 0
    case 'WEEKLY': {
      const startWeekOffset = (start.getUTCDay() + 6) % 7
      const weekOffset = Math.floor((elapsedDays + startWeekOffset) / 7)
      const days = rule.byDay?.split(',').map((day) => day.trim()) ?? [WEEKDAYS[start.getUTCDay()]]
      return weekOffset % interval === 0 && days.includes(WEEKDAYS[date.getUTCDay()])
    }
    case 'MONTHLY': {
      if (monthOffset % interval !== 0) return false
      if (rule.bySetPos && rule.byDay) {
        const days = rule.byDay.split(',').map((day) => day.trim())
        const matchingDays = Array.from({ length: lastDay }, (_, index) => index + 1)
          .filter((day) => days.includes(WEEKDAYS[new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), day)).getUTCDay()]))
        const index = rule.bySetPos > 0 ? rule.bySetPos - 1 : matchingDays.length + rule.bySetPos
        return date.getUTCDate() === matchingDays[index]
      }
      const requestedDay = rule.byMonthDay || start.getUTCDate()
      const day = requestedDay < 0 ? lastDay + requestedDay + 1 : Math.min(requestedDay, lastDay)
      return date.getUTCDate() === day
    }
    case 'YEARLY':
      return (date.getUTCFullYear() - start.getUTCFullYear()) % interval === 0
        && date.getUTCMonth() === start.getUTCMonth()
        && date.getUTCDate() === Math.min(start.getUTCDate(), lastDay)
  }
}

function isWithinRepeatRange(start: Date, end: Date | null, date: Date) {
  if (date < start) return false
  if (end && date > end) return false
  return true
}

/** 반복 횟수(maxOccurrences) 안에 들어오는 회차인지 확인한다. */
function isWithinMaxOccurrences(rule: RecurringRuleRecord, start: Date, date: Date) {
  // Older cached API records converted an unlimited (null) count to zero.
  if (rule.maxOccurrences == null || rule.maxOccurrences <= 0) return true

  let count = 0
  for (let time = start.getTime(); time <= date.getTime(); time += DAY_MS) {
    if (matchesDate(rule, start, new Date(time)) && ++count > rule.maxOccurrences) return false
  }

  return true
}

/** 규칙상 원래 회차일인지 (공휴일 조정 전 기준) */
function isOriginalOccurrence(rule: RecurringRuleRecord, start: Date, end: Date | null, date: Date) {
  return isWithinRepeatRange(start, end, date)
    && matchesDate(rule, start, date)
    && isWithinMaxOccurrences(rule, start, date)
}

/** 공휴일 정책에 따라 원래 회차일을 실제 표시일로 옮긴다. 옮겨지지 않으면 null. */
function resolveHolidayShift(date: Date, action: HolidayAction): Date | null {
  if (action === 'SKIP') return null

  const step = action === 'NEXT_WORKDAY' ? 1 : -1
  let cursor = date

  for (let index = 0; index < MAX_HOLIDAY_SHIFT_DAYS; index += 1) {
    cursor = shiftDays(cursor, step)
    if (isWorkdayDate(toDateKey(cursor))) return cursor
  }

  return null
}

/** Calendar-date expansion; independent of the current clock and device timezone. */
export function occursOnCalendarDate(rule: RecurringRuleRecord, dateKey: string): boolean {
  if (!rule.isActive || rule.isDeleted) return false
  const start = parseDate(rule.repeatStartDate)
  const date = parseDate(dateKey)
  const end = rule.repeatEndDate ? parseDate(rule.repeatEndDate) : null
  if (!start || !date) return false

  // 공휴일 순연/조정으로 앞뒤로 밀릴 수 있는 범위만 후보로 본다.
  if (date < shiftDays(start, -MAX_HOLIDAY_SHIFT_DAYS)) return false
  if (end && date > shiftDays(end, MAX_HOLIDAY_SHIFT_DAYS)) return false

  const excludeHolidays = rule.excludeHolidays !== false
  const action: HolidayAction = rule.holidayAction ?? 'SKIP'

  // 1) 이 날짜가 원래 회차일인 경우
  if (isOriginalOccurrence(rule, start, end, date)) {
    // 공휴일 예외 정책을 쓰지 않으면 그대로 표시한다.
    if (!excludeHolidays) return true
    // 공휴일이면 SKIP은 표시하지 않고, 순연/조정은 다른 날짜로 옮겨서 표시한다.
    return !isHolidayDate(dateKey)
  }

  // 2) 공휴일이라 옮겨진 회차가 이 날짜로 오는 경우
  if (!excludeHolidays || action === 'SKIP') return false

  // NEXT_WORKDAY의 원래 회차일은 이 날짜보다 앞, PREV_WORKDAY는 뒤에 있다.
  const sourceOffset = action === 'NEXT_WORKDAY' ? -1 : 1

  for (let index = 1; index <= MAX_HOLIDAY_SHIFT_DAYS; index += 1) {
    const source = shiftDays(date, sourceOffset * index)
    if (!isHolidayDate(toDateKey(source))) continue
    if (!isOriginalOccurrence(rule, start, end, source)) continue

    const shifted = resolveHolidayShift(source, action)
    if (shifted && toDateKey(shifted) === dateKey) return true
  }

  return false
}

export function getSchedulesForCalendarDate(rules: RecurringRuleRecord[], dateKey: string): RecurringRuleRecord[] {
  return rules.filter((rule) => occursOnCalendarDate(rule, dateKey))
    .sort((a, b) => (a.startTime || '09:00').localeCompare(b.startTime || '09:00') || a.ruleId - b.ruleId)
}