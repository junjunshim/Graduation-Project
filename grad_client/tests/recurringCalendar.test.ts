import assert from 'node:assert/strict'
import test from 'node:test'
import { getSchedulesForCalendarDate, occursOnCalendarDate } from '../renderer/features/workspace/model/recurringCalendar.js'
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
