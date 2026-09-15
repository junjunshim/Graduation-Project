import type { RecurringRuleRecord } from './recurringRuleTypes'

const DAY_MS = 86400000
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']

function parseDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null
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

/** Calendar-date expansion; independent of the current clock and device timezone. */
export function occursOnCalendarDate(rule: RecurringRuleRecord, dateKey: string): boolean {
  if (!rule.isActive || rule.isDeleted) return false
  const start = parseDate(rule.repeatStartDate)
  const date = parseDate(dateKey)
  const end = rule.repeatEndDate ? parseDate(rule.repeatEndDate) : null
  if (!start || !date || date < start || (end && date > end)) return false
  if (!matchesDate(rule, start, date)) return false
  // Older cached API records converted an unlimited (null) count to zero.
  if (rule.maxOccurrences != null && rule.maxOccurrences > 0) {
    let count = 0
    for (let time = start.getTime(); time <= date.getTime(); time += DAY_MS) {
      if (matchesDate(rule, start, new Date(time)) && ++count > rule.maxOccurrences) return false
    }
  }
  return true
}

export function getSchedulesForCalendarDate(rules: RecurringRuleRecord[], dateKey: string): RecurringRuleRecord[] {
  return rules.filter((rule) => occursOnCalendarDate(rule, dateKey))
    .sort((a, b) => (a.startTime || '09:00').localeCompare(b.startTime || '09:00') || a.ruleId - b.ruleId)
}
