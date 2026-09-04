import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import { formatWorkspaceShortDate } from '../model/formatters'
import { getCategoryBadgeStyle, getWorkItemStatusLabel } from '../model/labels'
import { getWorkItemTag, WORK_ITEM_TAGS } from '../model/workItemTags'
import type { OrganizationNodeRecord, RoleMember, WorkItemRecord } from '../model/types'
import styles from './WorkspaceTimelineTab.module.css'

type WorkspaceTimelineTabProps = {
  workItems: WorkItemRecord[]
  nodes: OrganizationNodeRecord[]
  members: RoleMember[]
}

type TimelineTone = 'purple' | 'blue' | 'green' | 'yellow'

type TimelineEntry = {
  item: WorkItemRecord
  start: number
  endExclusive: number
}

type TimelineGroup = {
  key: string
  name: string
  entries: TimelineEntry[]
  tone: TimelineTone
  style?: CSSProperties
}

type TimelineSegment = {
  key: string
  label: string
  left: number
  width: number
}

type TimelineMonthOption = {
  start: number
  end: number
  month: number
}

type TimelineMonthGroup = {
  year: number
  months: TimelineMonthOption[]
}

const MS_PER_DAY = 24 * 60 * 60 * 1000
const WORKSPACE_TIME_ZONE = 'Asia/Seoul'
const DEFAULT_PIXELS_PER_DAY = 18
const MIN_PIXELS_PER_DAY = 3
const MAX_PIXELS_PER_DAY = 64
const DEFAULT_VERTICAL_SCALE = 1
const MIN_VERTICAL_SCALE = 0.35
const MAX_VERTICAL_SCALE = 1.4
const ZOOM_BUTTON_FACTOR = 1.16
const GROUP_ROW_HEIGHT_REM = 2.85
const TASK_ROW_HEIGHT_REM = 2.45
const RANGE_PADDING_MONTHS = 6
const TIMELINE_TONES: TimelineTone[] = ['purple', 'blue', 'green', 'yellow']

const toneClassNames: Record<TimelineTone, string> = {
  purple: styles.tonePurple,
  blue: styles.toneBlue,
  green: styles.toneGreen,
  yellow: styles.toneYellow,
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function parseWorkspaceDay(value?: string) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/)

  if (!match) {
    return null
  }

  const [, rawYear, rawMonth, rawDay] = match
  const year = Number(rawYear)
  const month = Number(rawMonth) - 1
  const day = Number(rawDay)

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null
  }

  return Date.UTC(year, month, day)
}

function getWorkspaceTodayTimestamp() {
  const parts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    timeZone: WORKSPACE_TIME_ZONE,
    year: 'numeric',
  }).formatToParts(new Date())
  const year = Number(parts.find((part) => part.type === 'year')?.value)
  const month = Number(parts.find((part) => part.type === 'month')?.value)
  const day = Number(parts.find((part) => part.type === 'day')?.value)

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    const now = new Date()
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  }

  return Date.UTC(year, month - 1, day)
}

function formatMonthLabel(timestamp: number) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    timeZone: 'UTC',
    year: 'numeric',
  }).format(new Date(timestamp))
}

function getMonthStart(timestamp: number) {
  const date = new Date(timestamp)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
}

function formatTimelineMonthDay(timestamp: number) {
  const date = new Date(timestamp)
  return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`
}

function formatTickLabel(timestamp: number, stepDays: number) {
  const startLabel = formatTimelineMonthDay(timestamp)

  if (stepDays === 1) {
    return startLabel
  }

  const endLabel = formatTimelineMonthDay(timestamp + (stepDays - 1) * MS_PER_DAY)
  return `${startLabel} ~ ${endLabel}`
}

function getTimelineEntries(workItems: WorkItemRecord[]) {
  return workItems
    .map((item): TimelineEntry | null => {
      const parsedStart = parseWorkspaceDay(item.startDate) ?? parseWorkspaceDay(item.dueDate)

      if (parsedStart === null) {
        return null
      }

      const parsedEnd = parseWorkspaceDay(item.dueDate) ?? parsedStart + 6 * MS_PER_DAY
      const start = Math.min(parsedStart, parsedEnd)
      const end = Math.max(parsedStart, parsedEnd)

      return { item, start, endExclusive: end + MS_PER_DAY }
    })
    .filter((entry): entry is TimelineEntry => entry !== null)
    .sort(
      (left, right) =>
        left.start - right.start ||
        left.endExclusive - right.endExclusive ||
        left.item.title.localeCompare(right.item.title, 'ko'),
    )
}

function getMemberName(userId: string, members: RoleMember[]) {
  return members.find((member) => member.userId === userId)?.name ?? '담당자 미정'
}

function getTimelineRange(entries: TimelineEntry[], today: number) {
  const earliest = entries.length > 0 ? Math.min(today, ...entries.map((entry) => entry.start)) : today
  const latest = entries.length > 0 ? Math.max(today, ...entries.map((entry) => entry.endExclusive)) : today
  const earliestDate = new Date(earliest)
  const latestDate = new Date(latest)

  return {
    start: Date.UTC(earliestDate.getUTCFullYear(), earliestDate.getUTCMonth() - RANGE_PADDING_MONTHS, 1),
    end: Date.UTC(latestDate.getUTCFullYear(), latestDate.getUTCMonth() + RANGE_PADDING_MONTHS + 1, 1),
  }
}

export function WorkspaceTimelineTab({ workItems, members }: WorkspaceTimelineTabProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const labelColumnRef = useRef<HTMLDivElement>(null)
  const monthPickerRef = useRef<HTMLDivElement>(null)
  const monthMenuRef = useRef<HTMLDivElement>(null)
  const monthButtonRef = useRef<HTMLButtonElement>(null)
  const pixelsPerDayRef = useRef(DEFAULT_PIXELS_PER_DAY)
  const verticalScaleRef = useRef(DEFAULT_VERTICAL_SCALE)
  const pendingScrollRef = useRef<{
    behavior: ScrollBehavior
    left: number
    top: number
  } | null>(null)
  const virtualScrollLeftRef = useRef<number | null>(null)
  const virtualScrollTopRef = useRef<number | null>(null)
  const initializedRangeRef = useRef<number | null>(null)
  const dragRef = useRef<{ pointerId: number; scrollLeft: number; startX: number } | null>(null)
  const [pixelsPerDay, setPixelsPerDay] = useState(DEFAULT_PIXELS_PER_DAY)
  const [verticalScale, setVerticalScale] = useState(DEFAULT_VERTICAL_SCALE)
  const [minimumVerticalScale, setMinimumVerticalScale] = useState(MIN_VERTICAL_SCALE)
  const [isDragging, setIsDragging] = useState(false)
  const [isMonthMenuOpen, setIsMonthMenuOpen] = useState(false)
  const [hiddenGroupKeys, setHiddenGroupKeys] = useState<Set<string>>(() => new Set())
  const [collapsedGroupKeys, setCollapsedGroupKeys] = useState<Set<string>>(() => new Set())
  const [selectedMonthStart, setSelectedMonthStart] = useState(() =>
    getMonthStart(getWorkspaceTodayTimestamp()),
  )
  const today = getWorkspaceTodayTimestamp()

  const entries = useMemo(() => getTimelineEntries(workItems), [workItems])
  const groups = useMemo<TimelineGroup[]>(() => {
    const groupedEntries = new Map<string, { name: string; tone: TimelineTone; entries: TimelineEntry[] }>()

    entries.forEach((entry) => {
      const tag = getWorkItemTag(entry.item)
      const groupKey = tag ? tag.id : 'unclassified'
      const groupName = tag ? tag.label : '미분류'

      // 태그의 tone에 따라 적절한 타임라인 톤 매핑
      let groupTone: TimelineTone = 'purple'
      if (tag) {
        const toneStr = String(tag.tone)
        if (toneStr === 'blue' || toneStr === 'sky') groupTone = 'blue'
        else if (toneStr === 'green') groupTone = 'green'
        else if (toneStr === 'orange' || toneStr === 'amber' || toneStr === 'yellow') groupTone = 'yellow'
        else groupTone = 'purple'
      }

      const existing = groupedEntries.get(groupKey) ?? {
        name: groupName,
        tone: groupTone,
        entries: [],
      }
      existing.entries.push(entry)
      groupedEntries.set(groupKey, existing)
    })

    // 미리 정의된 태그 순서 (planning, research, design, document, review, release) 우선 정렬
    const tagOrder = Object.keys(WORK_ITEM_TAGS)

    return Array.from(groupedEntries.entries())
      .sort(([keyA], [keyB]) => {
        const indexA = tagOrder.indexOf(keyA)
        const indexB = tagOrder.indexOf(keyB)
        const orderA = indexA >= 0 ? indexA : 999
        const orderB = indexB >= 0 ? indexB : 999
        return orderA - orderB || keyA.localeCompare(keyB, 'ko')
      })
      .map(([key, groupData], index) => ({
        key,
        name: groupData.name,
        entries: groupData.entries,
        tone: groupData.tone || TIMELINE_TONES[index % TIMELINE_TONES.length],
        style: getCategoryBadgeStyle(groupData.name),
      }))
  }, [entries])

  const range = useMemo(() => getTimelineRange(entries, today), [entries, today])
  const totalDays = Math.max(1, Math.ceil((range.end - range.start) / MS_PER_DAY))
  const timelineTrackWidth = totalDays * pixelsPerDay
  const tickStepDays = pixelsPerDay >= 42 ? 1 : pixelsPerDay >= 17 ? 7 : pixelsPerDay >= 7 ? 14 : 30

  const monthGroups = useMemo<TimelineMonthGroup[]>(() => {
    const monthGroupList: TimelineMonthGroup[] = []

    for (let cursor = range.start; cursor < range.end; ) {
      const date = new Date(cursor)
      const year = date.getUTCFullYear()
      const month = date.getUTCMonth() + 1
      const nextMonth = Date.UTC(year, date.getUTCMonth() + 1, 1)
      const previousGroup = monthGroupList[monthGroupList.length - 1]

      if (previousGroup?.year === year) {
        previousGroup.months.push({ start: cursor, end: nextMonth, month })
      } else {
        monthGroupList.push({
          year,
          months: [{ start: cursor, end: nextMonth, month }],
        })
      }

      cursor = nextMonth
    }

    return monthGroupList
  }, [range.end, range.start])

  const tickSegments = useMemo<TimelineSegment[]>(() => {
    const segments: TimelineSegment[] = []
    const step = tickStepDays * MS_PER_DAY

    for (let cursor = range.start; cursor < range.end; cursor += step) {
      segments.push({
        key: `${cursor}-${tickStepDays}`,
        label: formatTickLabel(cursor, tickStepDays),
        left: ((cursor - range.start) / MS_PER_DAY) * pixelsPerDay,
        width: Math.min(tickStepDays, (range.end - cursor) / MS_PER_DAY) * pixelsPerDay,
      })
    }

    return segments
  }, [pixelsPerDay, range.end, range.start, tickStepDays])

  const monthSegments = useMemo<TimelineSegment[]>(() => {
    const segments: TimelineSegment[] = []

    tickSegments.forEach((tickSegment) => {
      const midpoint =
        range.start + ((tickSegment.left + tickSegment.width / 2) / pixelsPerDay) * MS_PER_DAY
      const midpointDate = new Date(midpoint)
      const monthStart = Date.UTC(midpointDate.getUTCFullYear(), midpointDate.getUTCMonth(), 1)
      const monthKey = new Date(monthStart).toISOString()
      const previousSegment = segments[segments.length - 1]

      if (previousSegment?.key === monthKey) {
        previousSegment.width = tickSegment.left + tickSegment.width - previousSegment.left
        return
      }

      segments.push({
        key: monthKey,
        label: formatMonthLabel(monthStart),
        left: tickSegment.left,
        width: tickSegment.width,
      })
    })

    return segments
  }, [pixelsPerDay, range.start, tickSegments])

  const getLabelColumnWidth = useCallback(() => labelColumnRef.current?.getBoundingClientRect().width ?? 0, [])
  const getDateHeaderHeight = useCallback(
    () => labelColumnRef.current?.getBoundingClientRect().height ?? 0,
    [],
  )
  const calculateMinimumVerticalScale = useCallback(() => {
    const viewport = viewportRef.current

    if (!viewport) {
      return MIN_VERTICAL_SCALE
    }

    const visibleGroups = groups.filter((group) => !hiddenGroupKeys.has(group.key))
    const visibleTaskCount = visibleGroups.reduce(
      (taskCount, group) =>
        taskCount + (collapsedGroupKeys.has(group.key) ? 0 : group.entries.length),
      0,
    )
    const rootFontSize = Number.parseFloat(getComputedStyle(viewport).fontSize) || 16
    const availableBodyHeight = Math.max(
      1,
      viewport.clientHeight - getDateHeaderHeight(),
    )
    const baseRowsHeight =
      (visibleGroups.length * GROUP_ROW_HEIGHT_REM +
        visibleTaskCount * TASK_ROW_HEIGHT_REM) *
      rootFontSize

    if (baseRowsHeight <= 0) {
      return DEFAULT_VERTICAL_SCALE
    }

    return clamp(
      Math.min(DEFAULT_VERTICAL_SCALE, availableBodyHeight / baseRowsHeight),
      MIN_VERTICAL_SCALE,
      DEFAULT_VERTICAL_SCALE,
    )
  }, [collapsedGroupKeys, getDateHeaderHeight, groups, hiddenGroupKeys])

  const applyView = useCallback(
    (
      nextPixelsPerDay: number,
      nextScrollLeft: number,
      nextVerticalScale: number,
      nextScrollTop: number,
      behavior: ScrollBehavior,
    ) => {
      const viewport = viewportRef.current

      if (!viewport) {
        return
      }

      const clampedPixelsPerDay = clamp(nextPixelsPerDay, MIN_PIXELS_PER_DAY, MAX_PIXELS_PER_DAY)
      const clampedVerticalScale = clamp(
        nextVerticalScale,
        MIN_VERTICAL_SCALE,
        MAX_VERTICAL_SCALE,
      )
      const hasHorizontalScaleChange =
        Math.abs(clampedPixelsPerDay - pixelsPerDayRef.current) >= 0.01
      const hasVerticalScaleChange =
        Math.abs(clampedVerticalScale - verticalScaleRef.current) >= 0.001

      if (!hasHorizontalScaleChange && !hasVerticalScaleChange) {
        const maximumScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
        const maximumScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
        viewport.scrollTo({
          left: clamp(nextScrollLeft, 0, maximumScrollLeft),
          top: clamp(nextScrollTop, 0, maximumScrollTop),
          behavior,
        })
        virtualScrollLeftRef.current = null
        virtualScrollTopRef.current = null
        return
      }

      pixelsPerDayRef.current = clampedPixelsPerDay
      verticalScaleRef.current = clampedVerticalScale
      pendingScrollRef.current = {
        behavior,
        left: nextScrollLeft,
        top: nextScrollTop,
      }
      virtualScrollLeftRef.current = nextScrollLeft
      virtualScrollTopRef.current = nextScrollTop

      if (hasHorizontalScaleChange) {
        setPixelsPerDay(clampedPixelsPerDay)
      }

      if (hasVerticalScaleChange) {
        setVerticalScale(clampedVerticalScale)
      }
    },
    [],
  )

  const centerDate = useCallback(
    (
      timestamp: number,
      nextPixelsPerDay: number,
      behavior: ScrollBehavior,
      nextVerticalScale = verticalScaleRef.current,
      nextScrollTop?: number,
    ) => {
      const viewport = viewportRef.current

      if (!viewport) {
        return
      }

      const trackViewportWidth = Math.max(1, viewport.clientWidth - getLabelColumnWidth())
      const dayOffset = (timestamp - range.start) / MS_PER_DAY
      const nextScrollLeft = dayOffset * nextPixelsPerDay - trackViewportWidth / 2

      applyView(
        nextPixelsPerDay,
        nextScrollLeft,
        nextVerticalScale,
        nextScrollTop ?? virtualScrollTopRef.current ?? viewport.scrollTop,
        behavior,
      )
    },
    [applyView, getLabelColumnWidth, range.start],
  )

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const pendingScroll = pendingScrollRef.current

    if (!viewport || !pendingScroll) {
      return
    }

    const maximumScrollLeft = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
    const maximumScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
    viewport.scrollTo({
      left: clamp(pendingScroll.left, 0, maximumScrollLeft),
      top: clamp(pendingScroll.top, 0, maximumScrollTop),
      behavior: pendingScroll.behavior,
    })
    pendingScrollRef.current = null
    virtualScrollLeftRef.current = null
    virtualScrollTopRef.current = null
  }, [pixelsPerDay, timelineTrackWidth, verticalScale])

  useLayoutEffect(() => {
    if (initializedRangeRef.current === range.start) {
      return
    }

    initializedRangeRef.current = range.start
    centerDate(
      today + MS_PER_DAY / 2,
      DEFAULT_PIXELS_PER_DAY,
      'auto',
      DEFAULT_VERTICAL_SCALE,
      0,
    )
  }, [centerDate, range.start, today])

  useLayoutEffect(() => {
    const viewport = viewportRef.current

    if (!viewport) {
      return undefined
    }

    const updateMinimumScale = () => {
      const nextMinimumVerticalScale = calculateMinimumVerticalScale()

      setMinimumVerticalScale((currentMinimumVerticalScale) =>
        Math.abs(currentMinimumVerticalScale - nextMinimumVerticalScale) < 0.001
          ? currentMinimumVerticalScale
          : nextMinimumVerticalScale,
      )

      if (verticalScaleRef.current < nextMinimumVerticalScale - 0.001) {
        applyView(
          pixelsPerDayRef.current,
          virtualScrollLeftRef.current ?? viewport.scrollLeft,
          nextMinimumVerticalScale,
          virtualScrollTopRef.current ?? viewport.scrollTop,
          'auto',
        )
      }
    }

    updateMinimumScale()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateMinimumScale)
      return () => window.removeEventListener('resize', updateMinimumScale)
    }

    const resizeObserver = new ResizeObserver(updateMinimumScale)
    resizeObserver.observe(viewport)

    return () => resizeObserver.disconnect()
  }, [applyView, calculateMinimumVerticalScale])

  useLayoutEffect(() => {
    if (!isMonthMenuOpen) {
      return
    }

    const selectedMonthButton =
      monthMenuRef.current?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')

    selectedMonthButton?.focus({ preventScroll: true })
    selectedMonthButton?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [isMonthMenuOpen, selectedMonthStart])

  useEffect(() => {
    if (!isMonthMenuOpen) {
      return undefined
    }

    const handleOutsidePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !monthPickerRef.current?.contains(event.target)) {
        setIsMonthMenuOpen(false)
      }
    }

    const handleMenuKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      setIsMonthMenuOpen(false)
      monthButtonRef.current?.focus()
    }

    document.addEventListener('pointerdown', handleOutsidePointerDown)
    document.addEventListener('keydown', handleMenuKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointerDown)
      document.removeEventListener('keydown', handleMenuKeyDown)
    }
  }, [isMonthMenuOpen])

  const zoomView = useCallback(
    (
      zoomFactor: number,
      horizontalAnchorOffset: number,
      _verticalAnchorOffset: number,
      behavior: ScrollBehavior,
    ) => {
      const viewport = viewportRef.current

      if (!viewport) {
        return
      }

      const currentPixelsPerDay = pixelsPerDayRef.current
      const nextPixelsPerDay = clamp(
        currentPixelsPerDay * zoomFactor,
        MIN_PIXELS_PER_DAY,
        MAX_PIXELS_PER_DAY,
      )
      const currentScrollLeft = virtualScrollLeftRef.current ?? viewport.scrollLeft
      const anchorDay = (currentScrollLeft + horizontalAnchorOffset) / currentPixelsPerDay
      const nextScrollLeft = anchorDay * nextPixelsPerDay - horizontalAnchorOffset
      const currentScrollTop = virtualScrollTopRef.current ?? viewport.scrollTop

      applyView(
        nextPixelsPerDay,
        nextScrollLeft,
        DEFAULT_VERTICAL_SCALE,
        currentScrollTop,
        behavior,
      )
    },
    [applyView],
  )

  useEffect(() => {
    const viewport = viewportRef.current

    if (!viewport) {
      return undefined
    }

    const handleWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        return
      }

      // 확대/축소는 반드시 Ctrl(또는 ⌘) 키를 누른 상태에서만 작동하도록 제한하여 일반 스크롤과 명확히 분리
      const isZoomGesture = event.ctrlKey || event.metaKey

      if (!isZoomGesture) {
        return
      }

      event.preventDefault()

      const deltaMultiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1
      const normalizedDelta = clamp(event.deltaY * deltaMultiplier, -120, 120)
      const zoomFactor = Math.exp(-normalizedDelta * 0.0016)

      const viewportRect = viewport.getBoundingClientRect()
      const labelWidth = getLabelColumnWidth()
      const dateHeaderHeight = getDateHeaderHeight()
      const trackViewportWidth = Math.max(1, viewport.clientWidth - labelWidth)
      const pointerX = event.clientX - viewportRect.left
      const horizontalAnchorOffset =
        pointerX > labelWidth ? clamp(pointerX - labelWidth, 0, trackViewportWidth) : trackViewportWidth / 2
      const pointerY = event.clientY - viewportRect.top
      const verticalAnchorOffset =
        pointerY > dateHeaderHeight
          ? clamp(pointerY, dateHeaderHeight, viewport.clientHeight)
          : dateHeaderHeight + Math.max(0, viewport.clientHeight - dateHeaderHeight) / 2

      zoomView(zoomFactor, horizontalAnchorOffset, verticalAnchorOffset, 'auto')
    }

    viewport.addEventListener('wheel', handleWheel, { passive: false })

    return () => viewport.removeEventListener('wheel', handleWheel)
  }, [getDateHeaderHeight, getLabelColumnWidth, zoomView])

  const handleTodayClick = () => {
    const currentToday = getWorkspaceTodayTimestamp()

    setSelectedMonthStart(getMonthStart(currentToday))
    setIsMonthMenuOpen(false)
    centerDate(
      currentToday + MS_PER_DAY / 2,
      pixelsPerDayRef.current,
      'smooth',
    )
  }

  const handleMonthSelect = (month: TimelineMonthOption) => {
    setSelectedMonthStart(month.start)
    setIsMonthMenuOpen(false)
    centerDate(
      month.start + (month.end - month.start) / 2,
      pixelsPerDayRef.current,
      'smooth',
    )
    monthButtonRef.current?.focus()
  }

  const handleZoomButtonClick = (zoomFactor: number) => {
    const viewport = viewportRef.current

    if (!viewport) {
      return
    }

    const labelWidth = getLabelColumnWidth()
    const dateHeaderHeight = getDateHeaderHeight()
    const horizontalAnchorOffset = Math.max(1, viewport.clientWidth - labelWidth) / 2
    const verticalAnchorOffset =
      dateHeaderHeight + Math.max(0, viewport.clientHeight - dateHeaderHeight) / 2

    zoomView(zoomFactor, horizontalAnchorOffset, verticalAnchorOffset, 'auto')
  }

  const zoomAnimationRef = useRef<number | null>(null)

  const handleResetZoomClick = () => {
    const viewport = viewportRef.current

    if (!viewport) {
      return
    }

    if (zoomAnimationRef.current !== null) {
      cancelAnimationFrame(zoomAnimationRef.current)
      zoomAnimationRef.current = null
    }

    const startPixelsPerDay = pixelsPerDayRef.current
    const targetPixelsPerDay = DEFAULT_PIXELS_PER_DAY

    if (Math.abs(startPixelsPerDay - targetPixelsPerDay) < 0.1) {
      return
    }

    const labelWidth = getLabelColumnWidth()
    const horizontalAnchorOffset = Math.max(1, viewport.clientWidth - labelWidth) / 2
    const currentScrollLeft = virtualScrollLeftRef.current ?? viewport.scrollLeft
    const anchorDay = (currentScrollLeft + horizontalAnchorOffset) / startPixelsPerDay
    const startTime = performance.now()
    const duration = 280 // ms

    const step = (now: number) => {
      const elapsed = now - startTime
      const progress = Math.min(1, elapsed / duration)
      // Ease out cubic
      const ease = 1 - Math.pow(1 - progress, 3)

      const currentTargetPpd = startPixelsPerDay + (targetPixelsPerDay - startPixelsPerDay) * ease
      const nextScrollLeft = anchorDay * currentTargetPpd - horizontalAnchorOffset

      applyView(
        currentTargetPpd,
        nextScrollLeft,
        DEFAULT_VERTICAL_SCALE,
        virtualScrollTopRef.current ?? viewport.scrollTop,
        'auto',
      )

      if (progress < 1) {
        zoomAnimationRef.current = requestAnimationFrame(step)
      } else {
        zoomAnimationRef.current = null
      }
    }

    zoomAnimationRef.current = requestAnimationFrame(step)
  }

  useEffect(() => {
    return () => {
      if (zoomAnimationRef.current !== null) {
        cancelAnimationFrame(zoomAnimationRef.current)
      }
    }
  }, [])

  const handleGroupVisibilityChange = (groupKey: string, isVisible: boolean) => {
    setHiddenGroupKeys((currentHiddenGroupKeys) => {
      const nextHiddenGroupKeys = new Set(currentHiddenGroupKeys)

      if (isVisible) {
        nextHiddenGroupKeys.delete(groupKey)
      } else {
        nextHiddenGroupKeys.add(groupKey)
      }

      return nextHiddenGroupKeys
    })
  }

  const handleGroupCollapseChange = (groupKey: string) => {
    setCollapsedGroupKeys((currentCollapsedGroupKeys) => {
      const nextCollapsedGroupKeys = new Set(currentCollapsedGroupKeys)

      if (nextCollapsedGroupKeys.has(groupKey)) {
        nextCollapsedGroupKeys.delete(groupKey)
      } else {
        nextCollapsedGroupKeys.add(groupKey)
      }

      return nextCollapsedGroupKeys
    })
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest('a, button'))) {
      return
    }

    const viewport = viewportRef.current

    if (!viewport) {
      return
    }

    dragRef.current = {
      pointerId: event.pointerId,
      scrollLeft: viewport.scrollLeft,
      startX: event.clientX,
    }
    viewport.setPointerCapture(event.pointerId)
    setIsDragging(true)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current

    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }

    const viewport = viewportRef.current

    if (!viewport) {
      return
    }

    const nextScrollLeft = drag.scrollLeft - (event.clientX - drag.startX)
    viewport.scrollLeft = nextScrollLeft
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current

    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }

    if (viewportRef.current?.hasPointerCapture(event.pointerId)) {
      viewportRef.current.releasePointerCapture(event.pointerId)
    }

    dragRef.current = null
    setIsDragging(false)
  }

  const canvasStyle = {
    '--timeline-grid-step': `${tickStepDays * pixelsPerDay}px`,
    '--timeline-track-width': `${timelineTrackWidth}px`,
    '--timeline-group-row-height': `${(GROUP_ROW_HEIGHT_REM * verticalScale).toFixed(3)}rem`,
    '--timeline-task-row-height': `${(TASK_ROW_HEIGHT_REM * verticalScale).toFixed(3)}rem`,
    '--timeline-group-padding-y': `${(0.68 * verticalScale).toFixed(3)}rem`,
    '--timeline-task-padding-y': `${(0.34 * verticalScale).toFixed(3)}rem`,
    '--timeline-bar-height': `${(1.72 * verticalScale).toFixed(3)}rem`,
    '--timeline-group-font-size': `${Math.max(0.62, 0.8 * verticalScale).toFixed(3)}rem`,
    '--timeline-task-font-size': `${Math.max(0.58, 0.76 * verticalScale).toFixed(3)}rem`,
    '--timeline-bar-font-size': `${Math.max(0.55, 0.7 * verticalScale).toFixed(3)}rem`,
    '--timeline-count-font-size': `${Math.max(0.55, 0.67 * verticalScale).toFixed(3)}rem`,
    '--timeline-count-height': `${Math.max(0.64, 1.15 * verticalScale).toFixed(3)}rem`,
  } as CSSProperties
  const timelineIconSize = clamp(Math.round(14 * verticalScale), 10, 18)
  const isZoomOutDisabled =
    entries.length === 0 ||
    (pixelsPerDay <= MIN_PIXELS_PER_DAY + 0.01 &&
      verticalScale <= minimumVerticalScale + 0.001)
  const isZoomInDisabled =
    entries.length === 0 ||
    (pixelsPerDay >= MAX_PIXELS_PER_DAY - 0.01 &&
      verticalScale >= MAX_VERTICAL_SCALE - 0.001)
  const todayLeft = ((today + MS_PER_DAY / 2 - range.start) / MS_PER_DAY) * pixelsPerDay

  const zoomRatio = pixelsPerDay / DEFAULT_PIXELS_PER_DAY
  const zoomMultiplierLabel = zoomRatio >= 10 ? `${Math.round(zoomRatio)}x` : zoomRatio >= 1 ? `${zoomRatio.toFixed(1).replace(/\.0$/, '')}x` : `${zoomRatio.toFixed(1)}x`

  return (
    <section className={styles.panel} aria-labelledby="workspace-timeline-title">
      <h2 id="workspace-timeline-title" className={styles.visuallyHidden}>
        타임라인
      </h2>
      <p id="workspace-timeline-instructions" className={styles.visuallyHidden}>
        일반 스크롤로 업무 목록을 이동하고, 컨트롤 또는 커맨드 키를 누른 채 휠을
        움직여 날짜 간격과 업무 행을 함께 확대하거나 축소할 수 있습니다. 전체
        버튼으로 표시 중인 모든 업무를 화면 높이에 맞출 수 있고, 조직 이름
        버튼으로 업무 목록을 접거나 펼칠 수 있습니다.
      </p>

      {entries.length === 0 ? (
        <div className={styles.emptyState}>
          <Icon name="calendar" size={22} />
          <strong>표시할 일정이 없습니다.</strong>
          <span>시작일 또는 마감일이 있는 업무가 여기에 표시됩니다.</span>
        </div>
      ) : (
        <div
          ref={viewportRef}
          className={[styles.viewport, isDragging ? styles.viewportDragging : ''].filter(Boolean).join(' ')}
          tabIndex={0}
          aria-label="워크스페이스 업무 타임라인"
          aria-describedby="workspace-timeline-instructions"
          title="스크롤로 목록 이동 · Ctrl(⌘)+휠로 가로·세로 확대/축소"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div className={styles.canvas} style={canvasStyle}>
            <div className={styles.dateHeader}>
              <div ref={labelColumnRef} className={[styles.headerLabel, styles.stickyLabel].join(' ')}>
                업무
              </div>
              <div className={styles.monthTrack} aria-hidden="true">
                {monthSegments.map((segment) => (
                  <span key={segment.key} style={{ left: segment.left, width: segment.width }}>
                    {segment.label}
                  </span>
                ))}
              </div>
              <div className={styles.tickTrack} aria-hidden="true">
                {tickSegments.map((segment) => (
                  <span key={segment.key} style={{ left: segment.left, width: segment.width }}>
                    {segment.label}
                  </span>
                ))}
              </div>
            </div>

            <div className={styles.timelineBody}>
              <span
                className={styles.todayLine}
                style={{ left: `calc(var(--timeline-label-width) + ${todayLeft}px)` }}
                aria-hidden="true"
              />
              <span
                className={styles.todayLabelTrack}
                style={{ left: `calc(var(--timeline-label-width) + ${todayLeft}px)` }}
                aria-hidden="true"
              >
                <b>오늘</b>
              </span>

              {groups.map((group, groupIndex) => {
                if (hiddenGroupKeys.has(group.key)) {
                  return null
                }

                const isCollapsed = collapsedGroupKeys.has(group.key)
                const groupEntriesId = `timeline-group-entries-${group.key}`

                return (
                  <section
                    key={group.key}
                    className={[styles.group, toneClassNames[group.tone]].join(' ')}
                    aria-labelledby={`timeline-group-${group.key}`}
                  >
                    <div className={styles.groupHeader}>
                      <button
                        type="button"
                        className={[styles.groupLabel, styles.stickyLabel].join(' ')}
                        aria-controls={groupEntriesId}
                        aria-expanded={!isCollapsed}
                        onClick={() => handleGroupCollapseChange(group.key)}
                      >
                        <span
                          className={[
                            styles.groupChevron,
                            isCollapsed ? styles.groupChevronCollapsed : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          aria-hidden="true"
                        >
                          <Icon name="chevronDown" size={timelineIconSize} />
                        </span>
                        <strong id={`timeline-group-${group.key}`}>
                          {String(groupIndex + 1).padStart(2, '0')}. {group.name}
                        </strong>
                        <span className={styles.groupCount} aria-label={`${group.entries.length}개 업무`}>
                          {group.entries.length}
                        </span>
                      </button>
                      <div className={styles.gridTrack} aria-hidden="true" />
                    </div>

                    <div
                      id={groupEntriesId}
                      className={[
                        styles.groupEntries,
                        isCollapsed ? styles.groupEntriesCollapsed : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <div className={styles.groupEntriesInner}>
                        {group.entries.map((entry) => {
                          const left = ((entry.start - range.start) / MS_PER_DAY) * pixelsPerDay
                          const width = Math.max(
                            18,
                            ((entry.endExclusive - entry.start) / MS_PER_DAY) * pixelsPerDay,
                          )
                          const memberName = getMemberName(entry.item.ownerUserId, members)

                          return (
                            <div key={entry.item.workItemId} className={styles.taskRow}>
                              <Link
                                to={`/work-items/${entry.item.workItemId}`}
                                className={[styles.taskLabel, styles.stickyLabel].join(' ')}
                                aria-label={`${entry.item.title}, ${memberName}, ${getWorkItemStatusLabel(entry.item.status)}`}
                              >
                                <span className={styles.taskIcon} aria-hidden="true">
                                  <Icon name="checkCircle" size={timelineIconSize} />
                                </span>
                                <span className={styles.taskCopy}>
                                  <strong>{entry.item.title}</strong>
                                </span>
                              </Link>
                              <div className={styles.gridTrack}>
                                <Link
                                  to={`/work-items/${entry.item.workItemId}`}
                                  className={styles.timelineBar}
                                  style={{
                                    left,
                                    width,
                                    ...(group.style ? {
                                      backgroundColor: group.style.backgroundColor,
                                      borderColor: group.style.borderColor,
                                      color: group.style.color,
                                    } : {}),
                                  }}
                                  aria-label={`${entry.item.title}, 마감일 ${formatWorkspaceShortDate(entry.item.dueDate)}`}
                                >
                                  <span>{`${entry.item.title} · ${formatWorkspaceShortDate(entry.item.dueDate)}`}</span>
                                </Link>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </section>
                )
              })}

              <div className={styles.emptyFillerRow} aria-hidden="true">
                <div className={[styles.emptyFillerLabel, styles.stickyLabel].join(' ')} />
                <div className={styles.gridTrack} />
              </div>
            </div>
          </div>
        </div>
      )}

      <footer className={styles.footer}>
        <div className={styles.legend} aria-label="타임라인 카테고리 표시">
          {groups.map((group) => {
            const isVisible = !hiddenGroupKeys.has(group.key)

            return (
              <label
                key={group.key}
                className={[styles.legendItem, toneClassNames[group.tone]].join(' ')}
              >
                <input
                  type="checkbox"
                  className={styles.legendCheckboxInput}
                  checked={isVisible}
                  onChange={(event) =>
                    handleGroupVisibilityChange(group.key, event.currentTarget.checked)
                  }
                />
                <span
                  className={[
                    styles.legendCheck,
                    isVisible ? styles.legendCheckSelected : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-hidden="true"
                />
                <i aria-hidden="true" />
                <strong>{group.name}</strong>
              </label>
            )
          })}
        </div>

        <div className={styles.controls}>
          <div className={styles.zoomControls} role="group" aria-label="타임라인 확대 및 축소">
            <button
              type="button"
              className={styles.zoomButton}
              aria-label="타임라인 축소"
              title="축소"
              disabled={isZoomOutDisabled}
              onClick={() => handleZoomButtonClick(1 / ZOOM_BUTTON_FACTOR)}
            >
              −
            </button>
            <button
              type="button"
              className={styles.zoomFitButton}
              aria-label="기본 배율(1x)로 초기화"
              title="클릭 시 기본 배율(1x)로 초기화"
              disabled={entries.length === 0}
              onClick={handleResetZoomClick}
            >
              {zoomMultiplierLabel}
            </button>
            <button
              type="button"
              className={styles.zoomButton}
              aria-label="타임라인 확대"
              title="확대"
              disabled={isZoomInDisabled}
              onClick={() => handleZoomButtonClick(ZOOM_BUTTON_FACTOR)}
            >
              +
            </button>
          </div>
          <button
            type="button"
            className={styles.controlButton}
            onClick={handleTodayClick}
            disabled={entries.length === 0}
          >
            오늘
          </button>
          <div ref={monthPickerRef} className={styles.monthPicker}>
            {isMonthMenuOpen && entries.length > 0 ? (
              <div
                id="workspace-timeline-month-menu"
                ref={monthMenuRef}
                className={styles.monthMenu}
                role="dialog"
                aria-label="이동할 월 선택"
              >
                {monthGroups.map((monthGroup) => (
                  <section key={monthGroup.year} className={styles.monthYearGroup}>
                    <strong className={styles.monthYearLabel}>{monthGroup.year}년</strong>
                    <div className={styles.monthGrid}>
                      {monthGroup.months.map((month) => {
                        const isSelected = month.start === selectedMonthStart

                        return (
                          <button
                            key={month.start}
                            type="button"
                            className={[
                              styles.monthOption,
                              isSelected ? styles.monthOptionSelected : '',
                            ]
                              .filter(Boolean)
                              .join(' ')}
                            aria-label={`${monthGroup.year}년 ${month.month}월로 이동`}
                            aria-pressed={isSelected}
                            onClick={() => handleMonthSelect(month)}
                          >
                            {month.month}월
                          </button>
                        )
                      })}
                    </div>
                  </section>
                ))}
              </div>
            ) : null}

            <button
              ref={monthButtonRef}
              type="button"
              className={styles.controlButton}
              aria-controls="workspace-timeline-month-menu"
              aria-expanded={isMonthMenuOpen}
              aria-haspopup="dialog"
              onClick={() => setIsMonthMenuOpen((isOpen) => !isOpen)}
              disabled={entries.length === 0}
            >
              월
              <span
                className={[
                  styles.monthChevron,
                  isMonthMenuOpen ? styles.monthChevronOpen : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-hidden="true"
              >
                <Icon name="chevronDown" size={13} />
              </span>
            </button>
          </div>
        </div>
      </footer>
    </section>
  )
}
