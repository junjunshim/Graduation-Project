import assert from 'node:assert/strict'
import test from 'node:test'
import { ensureHolidayYears, getHolidayNames } from '../renderer/features/workspace/model/koreanHolidays.js'
import { getSchedulesForCalendarDate, occursOnCalendarDate } from '../renderer/features/workspace/model/recurringCalendar.js'
import { getNextOccurrenceInfo } from '../renderer/features/workspace/model/recurringSchedule.js'
import type { RecurringRuleRecord } from '../renderer/features/workspace/model/recurringRuleTypes.js'
import { optionalRecurringNumber } from '../renderer/features/workspace/model/recurringRuleValues.js'

const daily: RecurringRuleRecord = {
  ruleId: 1, ownerNodeId: 42, creatorUserId: 'user', title: '일간 회의',
  category: 'MEETING', frequency: 'DAILY', intervalValue: 1,
  repeatStartDate: '2026-09-15', startTime: '09:00:00',
  createdAt: '2026-09-14T00:00:00Z',
  excludeHolidays: false, holidayAction: 'SKIP', autoCreateTask: false, isActive: true,
}

test('daily meeting starting Tuesday appears on every remaining day of the week', () => {
  assert.equal(occursOnCalendarDate(daily, '2026-09-14'), false)
  for (const day of [15, 16, 17, 18, 19, 20]) {
    assert.deepEqual(getSchedulesForCalendarDate([daily], `2026-09-${day}`), [daily])
  }
})

test('daily expansion respects interval, inclusive end date, and maximum occurrences', () => {
  const rule = { ...daily, intervalValue: 2, repeatEndDate: '2026-09-19' }
  assert.equal(occursOnCalendarDate(rule, '2026-09-16'), false)
  assert.equal(occursOnCalendarDate(rule, '2026-09-17'), true)
  assert.equal(occursOnCalendarDate(rule, '2026-09-19'), true)
  assert.equal(occursOnCalendarDate(rule, '2026-09-21'), false)
  assert.equal(occursOnCalendarDate({ ...daily, maxOccurrences: 2 }, '2026-09-16'), true)
  assert.equal(occursOnCalendarDate({ ...daily, maxOccurrences: 2 }, '2026-09-17'), false)
})

test('weekly expansion honors selected weekdays and alternate weeks', () => {
  const rule = { ...daily, frequency: 'WEEKLY' as const, byDay: 'TU,TH', intervalValue: 2 }
  assert.equal(occursOnCalendarDate(rule, '2026-09-15'), true)
  assert.equal(occursOnCalendarDate(rule, '2026-09-17'), true)
  assert.equal(occursOnCalendarDate(rule, '2026-09-18'), false)
  assert.equal(occursOnCalendarDate(rule, '2026-09-22'), false)
  assert.equal(occursOnCalendarDate(rule, '2026-09-29'), true)
})

test('monthly and yearly expansion respects month lengths and intervals', () => {
  const monthly = { ...daily, frequency: 'MONTHLY' as const, repeatStartDate: '2026-01-31', byMonthDay: 31 }
  assert.equal(occursOnCalendarDate(monthly, '2026-02-28'), true)
  assert.equal(occursOnCalendarDate(monthly, '2026-03-30'), false)
  assert.equal(occursOnCalendarDate({ ...monthly, intervalValue: 2 }, '2026-02-28'), false)
  const yearly = { ...daily, frequency: 'YEARLY' as const, intervalValue: 2 }
  assert.equal(occursOnCalendarDate(yearly, '2027-09-15'), false)
  assert.equal(occursOnCalendarDate(yearly, '2028-09-15'), true)
})

test('holiday policy skips, postpones, or advances occurrences (2026 추석)', async () => {
  await ensureHolidayYears([2026])
  assert.deepEqual(getHolidayNames('2026-09-25'), ['추석'])

  const skipped = { ...daily, excludeHolidays: true, holidayAction: 'SKIP' as const }
  assert.equal(occursOnCalendarDate(skipped, '2026-09-24'), false)
  assert.equal(occursOnCalendarDate(skipped, '2026-09-26'), false)
  assert.equal(occursOnCalendarDate(skipped, '2026-09-27'), true)

  const postponed = { ...daily, excludeHolidays: true, holidayAction: 'NEXT_WORKDAY' as const }
  assert.equal(occursOnCalendarDate(postponed, '2026-09-24'), false)
  assert.equal(occursOnCalendarDate(postponed, '2026-09-25'), false)
  assert.equal(occursOnCalendarDate(postponed, '2026-09-28'), true)

  const advanced = { ...daily, excludeHolidays: true, holidayAction: 'PREV_WORKDAY' as const }
  assert.equal(occursOnCalendarDate(advanced, '2026-09-24'), false)
  assert.equal(occursOnCalendarDate(advanced, '2026-09-23'), true)

  assert.equal(occursOnCalendarDate({ ...daily, excludeHolidays: false }, '2026-09-24'), true)
})

test('next occurrence follows the rule holiday policy', async () => {
  await ensureHolidayYears([2026])
  const thursday = {
    ...daily, frequency: 'WEEKLY' as const, byDay: 'TH',
    repeatStartDate: '2026-09-03', repeatEndDate: '2026-12-31',
    excludeHolidays: true, holidayAction: 'SKIP' as const,
  }
  const beforeChuseok = new Date(2026, 8, 23, 10, 0)
  assert.equal(getNextOccurrenceInfo(thursday, beforeChuseok).dateString, '2026.10.01 09:00')
  assert.equal(
    getNextOccurrenceInfo({ ...thursday, holidayAction: 'NEXT_WORKDAY' as const }, beforeChuseok).dateString,
    '2026.09.28 09:00',
  )
  assert.equal(
    getNextOccurrenceInfo({ ...thursday, holidayAction: 'PREV_WORKDAY' as const }, new Date(2026, 8, 23, 8, 0)).dateString,
    '2026.09.23 09:00',
  )
  assert.equal(
    getNextOccurrenceInfo({ ...thursday, excludeHolidays: false }, beforeChuseok).dateString,
    '2026.09.24 09:00',
  )
  assert.equal(getNextOccurrenceInfo({ ...thursday, repeatEndDate: '2026-09-01' }, beforeChuseok).dateString, '종료됨')
})

test('inactive and deleted schedules are excluded; cards sort by time', () => {
  const early = { ...daily, ruleId: 2, startTime: '08:00' }
  assert.deepEqual(getSchedulesForCalendarDate([
    daily, { ...daily, ruleId: 3, isDeleted: true }, { ...daily, ruleId: 4, isActive: false }, early,
  ], '2026-09-16'), [early, daily])
})

test('API null repeat limits and old zero-valued caches both keep daily schedules visible', () => {
  const serverResponse = { max_occurrences: null }
  const parsed = optionalRecurringNumber(serverResponse.max_occurrences)
  assert.equal(parsed, null)
  assert.equal(optionalRecurringNumber(undefined), null)
  assert.equal(optionalRecurringNumber('3'), 3)
  for (const maxOccurrences of [parsed, 0]) {
    for (const day of [15, 16, 17, 18, 19, 20]) {
      assert.equal(occursOnCalendarDate({ ...daily, maxOccurrences }, `2026-09-${day}`), true)
    }
  }
  assert.equal(occursOnCalendarDate({ ...daily, maxOccurrences: optionalRecurringNumber(2) }, '2026-09-17'), false)
})
