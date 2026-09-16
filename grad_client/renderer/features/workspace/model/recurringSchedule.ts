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

const WEEKLY_DAY_INDEXES: Record<string, number> = {
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
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

function resolveMonthlyDayOfMonth(rule: RecurringRuleRecord, year: number, monthIndex: number) {
  const lastDayOfMonth = new Date(year, monthIndex + 1, 0).getDate()

  if (rule.bySetPos && rule.byDay) {
    const weekdayIndexes = parseDayList(rule.byDay)
      .map((day) => WEEKLY_DAY_INDEXES[day])
      .filter((index) => index !== undefined)
    const matchingDays = Array.from({ length: lastDayOfMonth }, (_, index) => index + 1).filter((day) =>
      weekdayIndexes.includes(new Date(year, monthIndex, day).getDay()),
    )
    const positionIndex = rule.bySetPos > 0 ? rule.bySetPos - 1 : matchingDays.length + rule.bySetPos

    return matchingDays[positionIndex] ?? null
  }

  return Math.min(rule.byMonthDay || 1, lastDayOfMonth)
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

/**
 * 오늘을 기준으로 다음 발생 일시(Next Occurrence) 및 D-Day 계산
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

  const [sYear, sMonth, sDay] = rule.repeatStartDate.split('-').map(Number)
  const startDate = new Date(sYear, sMonth - 1, sDay)

  const endDate = rule.repeatEndDate
    ? new Date(
        Number(rule.repeatEndDate.split('-')[0]),
        Number(rule.repeatEndDate.split('-')[1]) - 1,
        Number(rule.repeatEndDate.split('-')[2]),
        23,
        59,
        59,
      )
    : null

  // 이미 만료된 경우
  if (endDate && today > endDate) {
    return { nextDate: null, dDay: null, dateString: '종료됨' }
  }

  const [hour, minute] = rule.startTime ? rule.startTime.split(':').map(Number) : [9, 0]

  // 1. 일간(DAILY)
  if (rule.frequency === 'DAILY') {
    const step = Math.max(1, rule.intervalValue)
    let candidate = new Date(startDate)
    candidate.setHours(hour, minute, 0, 0)

    if (candidate < now) {
      const diffDays = Math.ceil((today.getTime() - startDate.getTime()) / DAY_MS)
      const cycles = Math.max(0, Math.ceil(diffDays / step))
      candidate = new Date(startDate.getTime() + cycles * step * DAY_MS)
      candidate.setHours(hour, minute, 0, 0)
      if (candidate < now) {
        candidate = new Date(candidate.getTime() + step * DAY_MS)
      }
    }

    if (endDate && candidate > endDate) {
      return { nextDate: null, dDay: null, dateString: '종료됨' }
    }

    const candidateDay = new Date(candidate.getFullYear(), candidate.getMonth(), candidate.getDate())
    const dDay = Math.round((candidateDay.getTime() - today.getTime()) / DAY_MS)
    return { nextDate: candidate, dDay, dateString: formatTimestamp(candidate, hour, minute) }
  }

  // 2. 주간(WEEKLY)
  if (rule.frequency === 'WEEKLY') {
    const targetDays = rule.byDay
      ? parseDayList(rule.byDay).map((day) => WEEKLY_DAY_INDEXES[day]).filter((index) => index !== undefined)
      : [1] // 기본 월요일

    let candidateDate: Date | null = null
    // 향후 180일 탐색
    for (let i = 0; i <= 180; i++) {
      const test = new Date(today.getTime() + i * DAY_MS)
      if (test < startDate) continue
      if (endDate && test > endDate) break

      if (targetDays.includes(test.getDay())) {
        test.setHours(hour, minute, 0, 0)
        if (test >= now) {
          candidateDate = test
          break
        }
      }
    }

    if (!candidateDate) {
      return { nextDate: null, dDay: null, dateString: '예정 없음' }
    }

    const candidateDay = new Date(candidateDate.getFullYear(), candidateDate.getMonth(), candidateDate.getDate())
    const dDay = Math.round((candidateDay.getTime() - today.getTime()) / DAY_MS)
    return { nextDate: candidateDate, dDay, dateString: formatTimestamp(candidateDate, hour, minute) }
  }

  // 3. 월간(MONTHLY)
  if (rule.frequency === 'MONTHLY') {
    let candidateDate: Date | null = null

    for (let m = 0; m < 24; m++) {
      const testMonth = new Date(now.getFullYear(), now.getMonth() + m, 1)
      const day = resolveMonthlyDayOfMonth(rule, testMonth.getFullYear(), testMonth.getMonth())
      if (day === null) continue
      const test = new Date(testMonth.getFullYear(), testMonth.getMonth(), day, hour, minute, 0, 0)

      if (test < startDate) continue
      if (endDate && test > endDate) break

      if (test >= now) {
        candidateDate = test
        break
      }
    }

    if (!candidateDate) {
      return { nextDate: null, dDay: null, dateString: '예정 없음' }
    }

    const candidateDay = new Date(candidateDate.getFullYear(), candidateDate.getMonth(), candidateDate.getDate())
    const dDay = Math.round((candidateDay.getTime() - today.getTime()) / DAY_MS)
    return { nextDate: candidateDate, dDay, dateString: formatTimestamp(candidateDate, hour, minute) }
  }

  // 4. 연간(YEARLY)
  if (rule.frequency === 'YEARLY') {
    let candidateDate: Date | null = null
    for (let y = 0; y < 5; y++) {
      const testYear = now.getFullYear() + y
      const test = new Date(testYear, startDate.getMonth(), startDate.getDate(), hour, minute, 0, 0)

      if (test < startDate) continue
      if (endDate && test > endDate) break

      if (test >= now) {
        candidateDate = test
        break
      }
    }

    if (!candidateDate) {
      return { nextDate: null, dDay: null, dateString: '예정 없음' }
    }

    const candidateDay = new Date(candidateDate.getFullYear(), candidateDate.getMonth(), candidateDate.getDate())
    const dDay = Math.round((candidateDay.getTime() - today.getTime()) / DAY_MS)
    return { nextDate: candidateDate, dDay, dateString: formatTimestamp(candidateDate, hour, minute) }
  }

  return { nextDate: null, dDay: null, dateString: '-' }
}