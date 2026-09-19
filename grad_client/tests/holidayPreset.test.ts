import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ensureHolidayYears,
  getHolidayNames,
  isHolidayDate,
  isWorkdayDate,
  readHolidayYear,
} from '../renderer/features/workspace/model/koreanHolidays.js'
import { buildComputedHolidayPreset } from '../renderer/features/workspace/model/koreanHolidaysFallback.js'
import { getHolidayPreset } from '@hyunbinseo/holidays-kr'

test('computed fallback adds 노동절·제헌절 and their substitute holidays', () => {
  const y2026 = buildComputedHolidayPreset(2026)
  assert.deepEqual(y2026['2026-05-01'], ['노동절'])
  assert.deepEqual(y2026['2026-07-17'], ['제헌절'])
  assert.equal(y2026['2026-05-02'], undefined)

  const y2027 = buildComputedHolidayPreset(2027)
  assert.deepEqual(y2027['2027-05-01'], ['노동절'])
  assert.deepEqual(y2027['2027-05-03'], ['대체공휴일(노동절)'])
  assert.deepEqual(y2027['2027-07-19'], ['대체공휴일(제헌절)'])
})

test('computed fallback marks holidays for years past the recorded range', () => {
  const y2030 = buildComputedHolidayPreset(2030)
  assert.deepEqual(y2030['2030-02-03'], ['설날'])
  assert.deepEqual(y2030['2030-02-05'], ['대체공휴일(설날)'])
  assert.deepEqual(y2030['2030-09-12'], ['추석'])
  assert.deepEqual(y2030['2030-05-01'], ['노동절'])
  assert.deepEqual(y2030['2030-07-17'], ['제헌절'])
})

test('computed fallback does not invent holidays for recorded years', async () => {
  for (const year of [2026, 2027]) {
    const recorded = await getHolidayPreset(String(year))
    const patched = new Set([
      `${year}-05-01`,
      `${year}-07-17`,
      `${year}-05-03`,
      `${year}-07-19`,
    ])
    const spurious = Object.keys(buildComputedHolidayPreset(year)).filter(
      (date) => !(date in recorded) && !patched.has(date),
    )
    assert.deepEqual(spurious, [])
  }
})

test('holiday lookup uses recorded data first and the computed fallback afterwards', async () => {
  await ensureHolidayYears([2026, 2030])
  assert.deepEqual(getHolidayNames('2026-05-01'), ['노동절'])
  assert.deepEqual(getHolidayNames('2026-09-25'), ['추석'])
  assert.deepEqual(getHolidayNames('2030-09-12'), ['추석'])
  assert.equal(isHolidayDate('2030-09-12'), true)
  assert.equal(isWorkdayDate('2030-05-01'), false)
  assert.equal(isWorkdayDate('2030-05-02'), true)
  assert.equal(readHolidayYear('2030-09-12'), 2030)
  assert.equal(getHolidayNames('1990-01-01'), null)
})