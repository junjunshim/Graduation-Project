import type { WorkItemRecord } from './types'

export type DueScheduleType = 'overdue' | 'dueSoon' | 'plenty' | 'none'
export type DueStatusTone = 'neutral' | 'soon' | 'overdue' | 'done'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const WORKSPACE_TIME_ZONE = 'Asia/Seoul'

const WORKSPACE_DAY_FORMATTER = new Intl.DateTimeFormat('en-US', {
  day: '2-digit',
  month: '2-digit',
  timeZone: WORKSPACE_TIME_ZONE,
  year: 'numeric',
})

export function getWorkspaceTodayTimestamp() {
  let year = Number.NaN
  let month = Number.NaN
  let day = Number.NaN

  WORKSPACE_DAY_FORMATTER.formatToParts(new Date()).forEach((part) => {
    if (part.type === 'year') {
      year = Number(part.value)
    } else if (part.type === 'month') {
      month = Number(part.value)
    } else if (part.type === 'day') {
      day = Number(part.value)
    }
  })

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return Date.now()
  }

  return Date.UTC(year, month - 1, day)
}

export function parseWorkspaceDay(value?: string) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/)

  if (!match) {
    return null
  }

  const [, rawYear, rawMonth, rawDay] = match
  const year = Number(rawYear)
  const monthIndex = Number(rawMonth) - 1
  const day = Number(rawDay)

  if (!Number.isFinite(year) || !Number.isFinite(monthIndex) || !Number.isFinite(day)) {
    return null
  }

  const timestamp = Date.UTC(year, monthIndex, day)
  const parsedDate = new Date(timestamp)

  if (
    parsedDate.getUTCFullYear() !== year ||
    parsedDate.getUTCMonth() !== monthIndex ||
    parsedDate.getUTCDate() !== day
  ) {
    return null
  }

  return timestamp
}

export function getWorkItemDueScheduleInfo(
  item: WorkItemRecord,
  todayTimestamp = getWorkspaceTodayTimestamp(),
): {
  scheduleType: DueScheduleType
  label: string
  tone: DueStatusTone
  dayDistance: number | null
} {
  if (item.status === 'done') {
    return { scheduleType: 'none', label: '완료됨', tone: 'done', dayDistance: null }
  }

  const dueTimestamp = parseWorkspaceDay(item.dueDate)

  if (dueTimestamp === null) {
    return { scheduleType: 'none', label: '마감 미정', tone: 'neutral', dayDistance: null }
  }

  const dayDistance = Math.round((dueTimestamp - todayTimestamp) / MS_PER_DAY)

  if (dayDistance < 0) {
    return {
      scheduleType: 'overdue',
      label: `${Math.abs(dayDistance)}일 지남`,
      tone: 'overdue',
      dayDistance,
    }
  }

  if (dayDistance === 0) {
    return {
      scheduleType: 'dueSoon',
      label: '오늘 마감',
      tone: 'soon',
      dayDistance,
    }
  }

  if (dayDistance <= 7) {
    return {
      scheduleType: 'dueSoon',
      label: `${dayDistance}일 남음`,
      tone: 'soon',
      dayDistance,
    }
  }

  return {
    scheduleType: 'plenty',
    label: '여유 있음',
    tone: 'neutral',
    dayDistance,
  }
}

export function isWorkItemDueSoon(item: WorkItemRecord, todayTimestamp = getWorkspaceTodayTimestamp()) {
  return getWorkItemDueScheduleInfo(item, todayTimestamp).scheduleType === 'dueSoon'
}
