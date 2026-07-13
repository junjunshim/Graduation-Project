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
import { getWorkItemStatusLabel } from '../model/labels'
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
  nodeId: number
  name: string
  entries: TimelineEntry[]
  tone: TimelineTone
}

type TimelineSegment = {
  key: string
  label: string
  left: number
  width: number
}

const MS_PER_DAY = 24 * 60 * 60 * 1000
const WORKSPACE_TIME_ZONE = 'Asia/Seoul'
const DEFAULT_PIXELS_PER_DAY = 18
const MIN_PIXELS_PER_DAY = 8
const MAX_PIXELS_PER_DAY = 64
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

export function WorkspaceTimelineTab({ workItems, nodes, members }: WorkspaceTimelineTabProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const labelColumnRef = useRef<HTMLDivElement>(null)
  const pixelsPerDayRef = useRef(DEFAULT_PIXELS_PER_DAY)
  const pendingScrollRef = useRef<{ behavior: ScrollBehavior; left: number } | null>(null)
  const virtualScrollLeftRef = useRef<number | null>(null)
  const initializedRangeRef = useRef<number | null>(null)
  const dragRef = useRef<{ pointerId: number; scrollLeft: number; startX: number } | null>(null)
  const [pixelsPerDay, setPixelsPerDay] = useState(DEFAULT_PIXELS_PER_DAY)
  const [isDragging, setIsDragging] = useState(false)
  const today = getWorkspaceTodayTimestamp()

  const entries = useMemo(() => getTimelineEntries(workItems), [workItems])
  const groups = useMemo<TimelineGroup[]>(() => {
    const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]))
    const nodeNames = new Map(nodes.map((node) => [node.id, node.name]))
    const groupedEntries = new Map<number, TimelineEntry[]>()

    entries.forEach((entry) => {
      const existing = groupedEntries.get(entry.item.ownerNodeId) ?? []
      existing.push(entry)
      groupedEntries.set(entry.item.ownerNodeId, existing)
    })

    return Array.from(groupedEntries.entries())
      .sort(
        ([leftNodeId], [rightNodeId]) =>
          (nodeOrder.get(leftNodeId) ?? Number.MAX_SAFE_INTEGER) -
            (nodeOrder.get(rightNodeId) ?? Number.MAX_SAFE_INTEGER) ||
          leftNodeId - rightNodeId,
      )
      .map(([nodeId, groupEntries], index) => ({
        nodeId,
        name: nodeNames.get(nodeId) ?? `워크스페이스 ${nodeId}`,
        entries: groupEntries,
        tone: TIMELINE_TONES[index % TIMELINE_TONES.length],
      }))
  }, [entries, nodes])

  const range = useMemo(() => getTimelineRange(entries, today), [entries, today])
  const totalDays = Math.max(1, Math.ceil((range.end - range.start) / MS_PER_DAY))
  const timelineTrackWidth = totalDays * pixelsPerDay
  const tickStepDays = pixelsPerDay >= 42 ? 1 : pixelsPerDay >= 17 ? 7 : 14

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

  const applyView = useCallback(
    (nextPixelsPerDay: number, nextScrollLeft: number, behavior: ScrollBehavior) => {
      const viewport = viewportRef.current

      if (!viewport) {
        return
      }

      const clampedPixelsPerDay = clamp(nextPixelsPerDay, MIN_PIXELS_PER_DAY, MAX_PIXELS_PER_DAY)

      if (Math.abs(clampedPixelsPerDay - pixelsPerDayRef.current) < 0.01) {
        const maximumScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
        viewport.scrollTo({ left: clamp(nextScrollLeft, 0, maximumScroll), behavior })
        virtualScrollLeftRef.current = null
        return
      }

      pixelsPerDayRef.current = clampedPixelsPerDay
      pendingScrollRef.current = { behavior, left: nextScrollLeft }
      virtualScrollLeftRef.current = nextScrollLeft
      setPixelsPerDay(clampedPixelsPerDay)
    },
    [],
  )

  const centerDate = useCallback(
    (timestamp: number, nextPixelsPerDay: number, behavior: ScrollBehavior) => {
      const viewport = viewportRef.current

      if (!viewport) {
        return
      }

      const trackViewportWidth = Math.max(1, viewport.clientWidth - getLabelColumnWidth())
      const dayOffset = (timestamp - range.start) / MS_PER_DAY
      const nextScrollLeft = dayOffset * nextPixelsPerDay - trackViewportWidth / 2
      applyView(nextPixelsPerDay, nextScrollLeft, behavior)
    },
    [applyView, getLabelColumnWidth, range.start],
  )

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const pendingScroll = pendingScrollRef.current

    if (!viewport || !pendingScroll) {
      return
    }

    const maximumScroll = Math.max(0, viewport.scrollWidth - viewport.clientWidth)
    viewport.scrollTo({
      left: clamp(pendingScroll.left, 0, maximumScroll),
      behavior: pendingScroll.behavior,
    })
    pendingScrollRef.current = null
    virtualScrollLeftRef.current = null
  }, [pixelsPerDay, timelineTrackWidth])

  useLayoutEffect(() => {
    if (initializedRangeRef.current === range.start) {
      return
    }

    initializedRangeRef.current = range.start
    centerDate(today + MS_PER_DAY / 2, DEFAULT_PIXELS_PER_DAY, 'auto')
  }, [centerDate, range.start, today])

  useEffect(() => {
    const viewport = viewportRef.current

    if (!viewport) {
      return undefined
    }

    const handleWheel = (event: WheelEvent) => {
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        return
      }

      event.preventDefault()

      const deltaMultiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1
      const normalizedDelta = clamp(event.deltaY * deltaMultiplier, -120, 120)
      const currentPixelsPerDay = pixelsPerDayRef.current
      const nextPixelsPerDay = clamp(
        currentPixelsPerDay * Math.exp(-normalizedDelta * 0.0016),
        MIN_PIXELS_PER_DAY,
        MAX_PIXELS_PER_DAY,
      )

      if (Math.abs(nextPixelsPerDay - currentPixelsPerDay) < 0.01) {
        return
      }

      const viewportRect = viewport.getBoundingClientRect()
      const labelWidth = getLabelColumnWidth()
      const trackViewportWidth = Math.max(1, viewport.clientWidth - labelWidth)
      const pointerX = event.clientX - viewportRect.left
      const anchorOffset =
        pointerX > labelWidth ? clamp(pointerX - labelWidth, 0, trackViewportWidth) : trackViewportWidth / 2
      const currentScrollLeft = virtualScrollLeftRef.current ?? viewport.scrollLeft
      const anchorDay = (currentScrollLeft + anchorOffset) / currentPixelsPerDay
      const nextScrollLeft = anchorDay * nextPixelsPerDay - anchorOffset

      pixelsPerDayRef.current = nextPixelsPerDay
      pendingScrollRef.current = { behavior: 'auto', left: nextScrollLeft }
      virtualScrollLeftRef.current = nextScrollLeft
      setPixelsPerDay(nextPixelsPerDay)
    }

    viewport.addEventListener('wheel', handleWheel, { passive: false })

    return () => viewport.removeEventListener('wheel', handleWheel)
  }, [getLabelColumnWidth])

  const handleTodayClick = () => {
    centerDate(getWorkspaceTodayTimestamp() + MS_PER_DAY / 2, DEFAULT_PIXELS_PER_DAY, 'smooth')
  }

  const handleMonthClick = () => {
    const currentDate = new Date(getWorkspaceTodayTimestamp())
    const monthStart = Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), 1)
    const nextMonth = Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth() + 1, 1)

    centerDate(monthStart + (nextMonth - monthStart) / 2, DEFAULT_PIXELS_PER_DAY, 'smooth')
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
    const viewport = viewportRef.current
    const drag = dragRef.current

    if (!viewport || !drag || drag.pointerId !== event.pointerId) {
      return
    }

    viewport.scrollLeft = drag.scrollLeft - (event.clientX - drag.startX)
  }

  const finishPointerDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current
    const drag = dragRef.current

    if (!viewport || !drag || drag.pointerId !== event.pointerId) {
      return
    }

    if (viewport.hasPointerCapture(event.pointerId)) {
      viewport.releasePointerCapture(event.pointerId)
    }

    dragRef.current = null
    setIsDragging(false)
  }

  const canvasStyle = {
    '--timeline-grid-step': `${tickStepDays * pixelsPerDay}px`,
    '--timeline-track-width': `${timelineTrackWidth}px`,
  } as CSSProperties
  const todayLeft = ((today + MS_PER_DAY / 2 - range.start) / MS_PER_DAY) * pixelsPerDay

  return (
    <section className={styles.panel} aria-labelledby="workspace-timeline-title">
      <h2 id="workspace-timeline-title" className={styles.visuallyHidden}>
        타임라인
      </h2>

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
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointerDrag}
          onPointerCancel={finishPointerDrag}
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
              <span className={styles.todayLine} style={{ left: `calc(var(--timeline-label-width) + ${todayLeft}px)` }} aria-hidden="true">
                <b>오늘</b>
              </span>

              {groups.map((group, groupIndex) => (
                <section
                  key={group.nodeId}
                  className={[styles.group, toneClassNames[group.tone]].join(' ')}
                  style={{ flexGrow: group.entries.length + 1 }}
                  aria-labelledby={`timeline-group-${group.nodeId}`}
                >
                  <div className={styles.groupHeader}>
                    <div className={[styles.groupLabel, styles.stickyLabel].join(' ')}>
                      <span className={styles.groupChevron} aria-hidden="true">
                        <Icon name="chevronDown" size={14} />
                      </span>
                      <strong id={`timeline-group-${group.nodeId}`}>
                        {String(groupIndex + 1).padStart(2, '0')}. {group.name}
                      </strong>
                    </div>
                    <div className={styles.gridTrack} aria-hidden="true" />
                  </div>

                  {group.entries.map((entry) => {
                    const left = ((entry.start - range.start) / MS_PER_DAY) * pixelsPerDay
                    const width = Math.max(18, ((entry.endExclusive - entry.start) / MS_PER_DAY) * pixelsPerDay)
                    const memberName = getMemberName(entry.item.ownerUserId, members)

                    return (
                      <div key={entry.item.workItemId} className={styles.taskRow}>
                        <Link
                          to={`/work-items/${entry.item.workItemId}`}
                          className={[styles.taskLabel, styles.stickyLabel].join(' ')}
                          aria-label={`${entry.item.title}, ${memberName}, ${getWorkItemStatusLabel(entry.item.status)}`}
                        >
                          <span className={styles.taskIcon} aria-hidden="true">
                            <Icon name="checkCircle" size={14} />
                          </span>
                          <span className={styles.taskCopy}>
                            <strong>{entry.item.title}</strong>
                          </span>
                        </Link>
                        <div className={styles.gridTrack}>
                          <Link
                            to={`/work-items/${entry.item.workItemId}`}
                            className={styles.timelineBar}
                            style={{ left, width }}
                            aria-label={`${entry.item.title}, ${formatWorkspaceShortDate(entry.item.startDate)}부터 ${formatWorkspaceShortDate(entry.item.dueDate)}까지`}
                          >
                            <span>{`${formatWorkspaceShortDate(entry.item.startDate)} ~ ${formatWorkspaceShortDate(entry.item.dueDate)}`}</span>
                          </Link>
                        </div>
                      </div>
                    )
                  })}
                </section>
              ))}
            </div>
          </div>
        </div>
      )}

      <footer className={styles.footer}>
        <div className={styles.legend} aria-label="타임라인 그룹 색상">
          {groups.map((group) => (
            <span key={group.nodeId} className={toneClassNames[group.tone]}>
              <span className={styles.legendCheck} aria-hidden="true">
                <Icon name="checkSquare" size={16} />
              </span>
              <i aria-hidden="true" />
              <strong>{group.name}</strong>
            </span>
          ))}
        </div>

        <div className={styles.controls}>
          <button
            type="button"
            className={styles.controlButton}
            onClick={handleTodayClick}
            disabled={entries.length === 0}
          >
            오늘
          </button>
          <button
            type="button"
            className={styles.controlButton}
            onClick={handleMonthClick}
            disabled={entries.length === 0}
          >
            월
            <Icon name="chevronDown" size={13} />
          </button>
        </div>
      </footer>
    </section>
  )
}
