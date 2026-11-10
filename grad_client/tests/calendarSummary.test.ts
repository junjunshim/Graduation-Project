import assert from 'node:assert/strict'
import test from 'node:test'
import { getWorkItemCalendarRangeStartKey } from '../renderer/features/calendar/model/calendarRange.js'

test('calendar work item range starts six months before today', () => {
  assert.equal(getWorkItemCalendarRangeStartKey(new Date(2026, 10, 10)), '2026-05-10')
  assert.equal(getWorkItemCalendarRangeStartKey(new Date(2026, 0, 15)), '2025-07-15')
})

test('calendar work item range clamps to the last day of a shorter month', () => {
  assert.equal(getWorkItemCalendarRangeStartKey(new Date(2026, 7, 31)), '2026-02-28')
  assert.equal(getWorkItemCalendarRangeStartKey(new Date(2024, 7, 31)), '2024-02-29')
})
