import { useEffect, useState } from 'react'
import { getHolidayPreset } from '@hyunbinseo/holidays-kr'
import {
  buildComputedHolidayPreset,
  COMPUTED_HOLIDAY_MAX_YEAR,
  COMPUTED_HOLIDAY_MIN_YEAR,
  isComputableHolidayYear,
} from './koreanHolidaysFallback.js'

/**
 * 대한민국 공휴일 데이터.
 *
 * 정부가 공표한 연도(관보/월력요항)는 공표 데이터를 그대로 쓰고, 아직 공표되지 않은 연도는
 * 법령 + 천문 계산 폴백(koreanHolidaysFallback)으로 채운다.
 * 라이브러리는 연도별 프리셋을 동적으로 불러오므로, 화면에서 쓰는 연도를 미리 적재해 두고
 * 이후에는 동기 조회(isHolidayDate / isWorkdayDate)만 사용한다.
 */

/** 정부가 공표한 공휴일 데이터를 쓰는 구간 */
export const RECORDED_HOLIDAY_MIN_YEAR = 2018
export const RECORDED_HOLIDAY_MAX_YEAR = 2027

/** 공휴일 판정이 가능한 전체 구간 (공표 데이터 + 계산 폴백) */
export const KOREAN_HOLIDAY_MIN_YEAR = COMPUTED_HOLIDAY_MIN_YEAR
export const KOREAN_HOLIDAY_MAX_YEAR = COMPUTED_HOLIDAY_MAX_YEAR

type HolidayPreset = Readonly<Record<string, readonly string[]>>

const presets = new Map<number, HolidayPreset>()
const loadingRequests = new Map<number, Promise<void>>()
const listeners = new Set<() => void>()

let revision = 0

function notifyListeners() {
  revision += 1

  for (const listener of Array.from(listeners)) {
    listener()
  }
}

export function isSupportedHolidayYear(year: number) {
  return isComputableHolidayYear(year)
}

function isRecordedHolidayYear(year: number) {
  return year >= RECORDED_HOLIDAY_MIN_YEAR && year <= RECORDED_HOLIDAY_MAX_YEAR
}

/** 계산 폴백으로 한 해의 공휴일을 만든다. 계산 범위를 벗어나면 '정보 없음'으로 취급한다. */
function buildComputedPreset(year: number): HolidayPreset {
  try {
    return buildComputedHolidayPreset(year)
  } catch {
    return {}
  }
}

/** 'YYYY-MM-DD' 에서 연도만 뽑는다. 형식이 아니면 null. */
export function readHolidayYear(dateKey: string) {
  const match = /^(\d{4})-\d{2}-\d{2}$/.exec(dateKey)
  return match ? Number(match[1]) : null
}

function loadHolidayYear(year: number): Promise<void> {
  if (!isSupportedHolidayYear(year) || presets.has(year)) {
    return Promise.resolve()
  }

  const inFlight = loadingRequests.get(year)
  if (inFlight) {
    return inFlight
  }

  // 아직 공표되지 않은 연도는 계산 폴백을 쓴다. 렌더 중에 호출될 수 있으므로 값은 즉시 채우고,
  // 구독자 알림(렌더 유발)만 마이크로태스크로 미룬다.
  if (!isRecordedHolidayYear(year)) {
    presets.set(year, buildComputedPreset(year))
    return Promise.resolve().then(notifyListeners)
  }

  const request = getHolidayPreset(String(year))
    .then((preset) => {
      presets.set(year, preset)
      notifyListeners()
    })
    .catch(() => {
      // 공표 데이터를 불러오지 못하면 계산 폴백으로 대체한다.
      presets.set(year, buildComputedPreset(year))
      notifyListeners()
    })
    .finally(() => {
      loadingRequests.delete(year)
    })

  loadingRequests.set(year, request)
  return request
}

/** 여러 연도의 공휴일 데이터를 미리 적재한다. 적재가 끝나면 구독자에게 알린다. */
export function ensureHolidayYears(years: Iterable<number>): Promise<void> {
  return Promise.all(Array.from(years, (year) => loadHolidayYear(year))).then(() => undefined)
}

export function subscribeToHolidays(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** 'YYYY-MM-DD' 의 공휴일 명칭들. 공휴일이 아니거나 데이터가 없으면 null. */
export function getHolidayNames(dateKey: string): readonly string[] | null {
  const year = readHolidayYear(dateKey)
  if (year == null) return null
  return presets.get(year)?.[dateKey] ?? null
}

/** 캘린더에 표시할 공휴일 문구 (예: '설날', '대체공휴일(광복절)') */
export function getHolidayLabel(dateKey: string): string | null {
  const names = getHolidayNames(dateKey)
  return names && names.length > 0 ? names.join(' · ') : null
}

export function isHolidayDate(dateKey: string) {
  return getHolidayNames(dateKey) !== null
}

/** 영업일 = 주말(토·일)이 아니면서 공휴일이 아닌 날 */
export function isWorkdayDate(dateKey: string) {
  const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay()
  if (!Number.isFinite(weekday) || weekday === 0 || weekday === 6) return false
  return !isHolidayDate(dateKey)
}

function getDefaultHolidayYears(anchor = new Date()) {
  const year = anchor.getFullYear()
  return [year - 1, year, year + 1]
}

// 캘린더·대시보드가 별도 적재 없이 바로 쓸 수 있도록 기본 범위를 미리 적재한다.
void ensureHolidayYears(getDefaultHolidayYears())

/**
 * 공휴일 데이터를 적재하고, 적재가 끝나면 다시 렌더링되도록 하는 훅.
 * 반환값(적재 세대)을 렌더 의존성에 넣으면 데이터 도착 후 화면이 갱신된다.
 */
export function useKoreanHolidays(years: number[] = []) {
  const [loadedRevision, setLoadedRevision] = useState(revision)

  useEffect(() => subscribeToHolidays(() => setLoadedRevision(revision)), [])

  const yearsKey = years.join(',')
  useEffect(() => {
    void ensureHolidayYears(yearsKey ? yearsKey.split(',').map(Number) : [])
  }, [yearsKey])

  return loadedRevision
}