import { getHolidays as getComputedHolidays } from 'kr-holidays'

/**
 * 법령 + 천문 계산으로 공휴일을 만들어내는 폴백.
 *
 * 정부 공표(관보/월력요항) 데이터는 아직 공표되지 않은 연도를 알 수 없으므로,
 * 공표 데이터가 없는 연도는 이 계산 결과를 사용한다.
 * 대체공휴일은 각 규칙의 법적 시행일을 반영한 kr-holidays 결과를 그대로 쓰고,
 * 2026년부터 법정공휴일로 편입된 고정일(노동절·제헌절)만 여기서 보정한다.
 */

/** kr-holidays가 계산으로 지원하는 연도 범위 */
export const COMPUTED_HOLIDAY_MIN_YEAR = 2014
export const COMPUTED_HOLIDAY_MAX_YEAR = 2500

/** 노동절·제헌절이 법정공휴일이 된 해 */
const FIXED_HOLIDAYS_SINCE_YEAR = 2026

/** kr-holidays 계산에 아직 없는 고정 공휴일 */
const FIXED_HOLIDAYS = [
  { month: 5, day: 1, name: '노동절' },
  { month: 7, day: 17, name: '제헌절' },
]

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_SUBSTITUTE_SEARCH_DAYS = 10

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

export function isComputableHolidayYear(year: number) {
  return Number.isFinite(year) && year >= COMPUTED_HOLIDAY_MIN_YEAR && year <= COMPUTED_HOLIDAY_MAX_YEAR
}

/**
 * 공휴일이 토·일요일이거나 다른 공휴일과 겹치면, 그 다음의 첫 번째 비공휴일을 대체공휴일로 지정한다.
 */
function appendSubstituteHoliday(presets: Map<string, string[]>, date: Date, holidayName: string) {
  let cursor = date

  for (let step = 0; step < MAX_SUBSTITUTE_SEARCH_DAYS; step += 1) {
    cursor = new Date(cursor.getTime() + DAY_MS)

    const weekday = cursor.getUTCDay()
    if (weekday === 0 || weekday === 6) continue

    const key = toDateKey(cursor)
    if (presets.has(key)) continue

    presets.set(key, [`대체공휴일(${holidayName})`])
    return
  }
}

/** 한 해의 공휴일을 'YYYY-MM-DD' -> 공휴일 명칭 목록 형태로 만든다. */
export function buildComputedHolidayPreset(year: number): Record<string, string[]> {
  const presets = new Map<string, string[]>()

  for (const holiday of getComputedHolidays(year)) {
    const name = holiday.substituteFor ? `대체공휴일(${holiday.substituteFor})` : holiday.name
    presets.set(holiday.date, [...(presets.get(holiday.date) ?? []), name])
  }

  if (year >= FIXED_HOLIDAYS_SINCE_YEAR) {
    for (const fixed of FIXED_HOLIDAYS) {
      const date = new Date(Date.UTC(year, fixed.month - 1, fixed.day))
      const dateKey = toDateKey(date)
      const names = presets.get(dateKey) ?? []

      if (!names.includes(fixed.name)) names.push(fixed.name)
      presets.set(dateKey, names)

      const weekday = date.getUTCDay()
      if (weekday === 0 || weekday === 6 || names.length > 1) {
        appendSubstituteHoliday(presets, date, fixed.name)
      }
    }
  }

  return Object.fromEntries([...presets.entries()].sort(([left], [right]) => left.localeCompare(right)))
}