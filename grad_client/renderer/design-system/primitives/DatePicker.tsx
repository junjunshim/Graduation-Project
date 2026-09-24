import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'
import styles from './DatePicker.module.css'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const CALENDAR_CELL_COUNT = 42
const WORKSPACE_TIME_ZONE = 'Asia/Seoul'
/** 패널을 위로 띄울지 판단할 때 쓰는 대략적인 높이(px) */
const PANEL_ESTIMATED_HEIGHT = 330
const WEEKDAY_LABELS = ['일', '월', '화', '수', '목', '금', '토']

type DatePickerProps = {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  minDate?: string
  maxDate?: string
  disabled?: boolean
  /** 드롭다운 패널 정렬. 기본은 트리거 왼쪽 기준. */
  panelAlign?: 'start' | 'end'
}

type CalendarCell = {
  timestamp: number
  year: number
  month: number
  day: number
  weekdayIndex: number
  isCurrentMonth: boolean
}

function padTwoDigits(value: number) {
  return String(value).padStart(2, '0')
}

function toDateValue(timestamp: number) {
  const date = new Date(timestamp)

  return `${date.getUTCFullYear()}-${padTwoDigits(date.getUTCMonth() + 1)}-${padTwoDigits(date.getUTCDate())}`
}

function getMonthStartTimestamp(timestamp: number) {
  const date = new Date(timestamp)

  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
}

function shiftMonthTimestamp(monthStart: number, offset: number) {
  const date = new Date(monthStart)

  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1)
}

function getMonthLength(monthStart: number) {
  const date = new Date(monthStart)

  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate()
}

function formatMonthLabel(monthStart: number) {
  const date = new Date(monthStart)

  return `${date.getUTCFullYear()}년 ${date.getUTCMonth() + 1}월`
}

function buildCalendarCells(monthStart: number): CalendarCell[] {
  const firstWeekday = new Date(monthStart).getUTCDay()
  const gridStart = monthStart - firstWeekday * MS_PER_DAY
  const visibleMonthIndex = new Date(monthStart).getUTCMonth()

  return Array.from({ length: CALENDAR_CELL_COUNT }, (_, index) => {
    const timestamp = gridStart + index * MS_PER_DAY
    const date = new Date(timestamp)

    return {
      timestamp,
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      weekdayIndex: index % 7,
      isCurrentMonth: date.getUTCMonth() === visibleMonthIndex,
    }
  })
}

function isTimestampDisabled(timestamp: number, minTimestamp: number | null, maxTimestamp: number | null) {
  return (minTimestamp !== null && timestamp < minTimestamp) || (maxTimestamp !== null && timestamp > maxTimestamp)
}

/** 워크스페이스 기준(Asia/Seoul) 오늘 자정의 UTC 타임스탬프 */
function getTodayTimestamp() {
  const dateParts = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    timeZone: WORKSPACE_TIME_ZONE,
    year: 'numeric',
  }).formatToParts(new Date())
  const year = Number(dateParts.find((part) => part.type === 'year')?.value)
  const month = Number(dateParts.find((part) => part.type === 'month')?.value)
  const day = Number(dateParts.find((part) => part.type === 'day')?.value)

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return Date.now()
  }

  return Date.UTC(year, month - 1, day)
}

/** 'YYYY-MM-DD' 문자열을 UTC 자정 타임스탬프로 바꾼다. 형식이 어긋나면 null. */
function parseDayValue(value?: string) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})/)

  if (!match) {
    return null
  }

  const year = Number(match[1])
  const monthIndex = Number(match[2]) - 1
  const day = Number(match[3])
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

/** 트리거에 보여주는 'YYYY.MM.DD' 라벨 */
function formatPickerDate(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/)

  return match ? match[1] + '.' + match[2] + '.' + match[3] : value
}

/**
 * 날짜 선택 드롭다운 (디자인 시스템 기본 요소).
 * 업무 생성/수정, 일정 생성/수정, 대시보드 업무 일정에서 공통으로 쓴다.
 * 값은 'YYYY-MM-DD' 문자열이며, 지우면 빈 문자열을 돌려준다.
 */
export function DatePicker({
  label,
  value,
  onChange,
  placeholder = '날짜를 선택하세요',
  minDate,
  maxDate,
  disabled = false,
  panelAlign = 'start',
}: DatePickerProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [visibleMonth, setVisibleMonth] = useState(() => getMonthStartTimestamp(getTodayTimestamp()))
  const [focusedTimestamp, setFocusedTimestamp] = useState<number | null>(null)
  const [panelPlacement, setPanelPlacement] = useState<'bottom' | 'top'>('bottom')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const dayButtonRefs = useRef(new Map<number, HTMLButtonElement>())
  const panelId = useId()

  const todayTimestamp = useMemo(() => getTodayTimestamp(), [])
  const selectedTimestamp = parseDayValue(value)
  const minTimestamp = parseDayValue(minDate)
  const maxTimestamp = parseDayValue(maxDate)

  const cells = useMemo(() => buildCalendarCells(visibleMonth), [visibleMonth])

  // 로빙 tabIndex 기준일: 키보드로 이동한 날짜 > 선택된 날짜 > 표시 중인 달의 첫 선택 가능 날짜
  const activeDayTimestamp = useMemo(() => {
    const candidates = [focusedTimestamp, selectedTimestamp]

    for (const candidate of candidates) {
      if (candidate !== null && cells.some((cell) => cell.timestamp === candidate)) {
        return candidate
      }
    }

    const firstEnabledDay = cells.find(
      (cell) => cell.isCurrentMonth && !isTimestampDisabled(cell.timestamp, minTimestamp, maxTimestamp),
    )

    return firstEnabledDay ? firstEnabledDay.timestamp : null
  }, [cells, focusedTimestamp, maxTimestamp, minTimestamp, selectedTimestamp])

  useEffect(() => {
    if (!isOpen || focusedTimestamp === null) {
      return
    }

    const dayButton = dayButtonRefs.current.get(focusedTimestamp)

    if (dayButton && !dayButton.disabled) {
      dayButton.focus()
    }
  }, [focusedTimestamp, isOpen, visibleMonth])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    return () => document.removeEventListener('mousedown', handlePointerDown)
  }, [isOpen])

  function isDayDisabled(timestamp: number) {
    return isTimestampDisabled(timestamp, minTimestamp, maxTimestamp)
  }

  // 선택 가능 범위(min/max)를 벗어난 날짜는 건너뛰며 키보드 포커스를 옮긴다
  function findEnabledDay(timestamp: number, step: number) {
    let candidate = timestamp

    for (let attempt = 0; attempt < 400; attempt += 1) {
      if (!isDayDisabled(candidate)) {
        return candidate
      }

      candidate += step
    }

    return timestamp
  }

  function focusDay(timestamp: number) {
    setFocusedTimestamp(timestamp)

    const nextMonth = getMonthStartTimestamp(timestamp)

    if (nextMonth !== visibleMonth) {
      setVisibleMonth(nextMonth)
    }
  }

  function shiftMonth(offset: number) {
    const nextMonth = shiftMonthTimestamp(visibleMonth, offset)
    setVisibleMonth(nextMonth)

    if (focusedTimestamp !== null) {
      const focusedDate = new Date(focusedTimestamp)
      const clampedDay = Math.min(focusedDate.getUTCDate(), getMonthLength(nextMonth))
      setFocusedTimestamp(nextMonth + (clampedDay - 1) * MS_PER_DAY)
    }
  }

  function openPanel() {
    const base = selectedTimestamp ?? todayTimestamp
    const triggerRect = containerRef.current?.getBoundingClientRect()

    // 모달 안처럼 아래 공간이 부족하면 패널을 위로 띄운다.
    if (triggerRect) {
      const spaceBelow = window.innerHeight - triggerRect.bottom
      setPanelPlacement(spaceBelow < PANEL_ESTIMATED_HEIGHT && triggerRect.top > spaceBelow ? 'top' : 'bottom')
    }

    setVisibleMonth(getMonthStartTimestamp(base))
    setFocusedTimestamp(selectedTimestamp ?? (isDayDisabled(todayTimestamp) ? null : todayTimestamp))
    setIsOpen(true)
  }

  function closePanel(restoreTriggerFocus: boolean) {
    setIsOpen(false)

    if (restoreTriggerFocus) {
      triggerRef.current?.focus()
    }
  }

  function commitSelection(timestamp: number) {
    onChange(toDateValue(timestamp))
    closePanel(true)
  }

  function clearSelection() {
    onChange('')
    setFocusedTimestamp(null)
  }

  function handlePanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const base = activeDayTimestamp ?? visibleMonth

    switch (event.key) {
      case 'Escape':
        event.preventDefault()
        closePanel(true)
        return
      case 'ArrowLeft':
        event.preventDefault()
        focusDay(findEnabledDay(base - MS_PER_DAY, -1))
        return
      case 'ArrowRight':
        event.preventDefault()
        focusDay(findEnabledDay(base + MS_PER_DAY, 1))
        return
      case 'ArrowUp':
        event.preventDefault()
        focusDay(findEnabledDay(base - 7 * MS_PER_DAY, -7))
        return
      case 'ArrowDown':
        event.preventDefault()
        focusDay(findEnabledDay(base + 7 * MS_PER_DAY, 7))
        return
      case 'PageUp':
        event.preventDefault()
        shiftMonth(-1)
        return
      case 'PageDown':
        event.preventDefault()
        shiftMonth(1)
        return
      default:
        return
    }
  }

  return (
    <div
      ref={containerRef}
      className={[styles.container, isOpen ? styles.containerOpen : ''].filter(Boolean).join(' ')}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setIsOpen(false)
        }
      }}
      onKeyDown={handlePanelKeyDown}
    >
      <button
        type="button"
        ref={triggerRef}
        className={[styles.trigger, isOpen ? styles.triggerOpen : ''].filter(Boolean).join(' ')}
        onClick={() => (isOpen ? closePanel(false) : openPanel())}
        disabled={disabled}
        aria-label={`${label} 선택`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
      >
        <span className={styles.triggerValue}>
          <Icon name="calendar" size={15} className={styles.triggerIcon} />
          {selectedTimestamp !== null ? (
            <span className={styles.triggerText}>{formatPickerDate(value)}</span>
          ) : (
            <span className={styles.triggerPlaceholder}>{placeholder}</span>
          )}
        </span>
        <Icon name="chevronDown" size={14} className={isOpen ? styles.chevronOpen : undefined} />
      </button>

      {isOpen ? (
        <div
          id={panelId}
          className={[
            styles.panel,
            panelAlign === 'end' ? styles.panelEnd : '',
            panelPlacement === 'top' ? styles.panelTop : '',
          ]
            .filter(Boolean)
            .join(' ')}
          role="dialog"
          aria-label={`${label} 달력`}
        >
          <div className={styles.panelHeader}>
            <span className={styles.monthLabel}>{formatMonthLabel(visibleMonth)}</span>
            <div className={styles.monthControls}>
              <button type="button" className={styles.monthButton} onClick={() => shiftMonth(-1)} aria-label="이전 달">
                <Icon name="chevronLeft" size={15} />
              </button>
              <button type="button" className={styles.monthButton} onClick={() => shiftMonth(1)} aria-label="다음 달">
                <Icon name="chevronRight" size={15} />
              </button>
            </div>
          </div>

          <div className={styles.weekdayRow}>
            {WEEKDAY_LABELS.map((weekdayLabel, index) => (
              <span
                key={weekdayLabel}
                className={[
                  styles.weekdayCell,
                  index === 0 ? styles.weekdaySunday : '',
                  index === 6 ? styles.weekdaySaturday : '',
                ].filter(Boolean).join(' ')}
              >
                {weekdayLabel}
              </span>
            ))}
          </div>

          <div className={styles.dayGrid}>
            {cells.map((cell) => {
              const isSelected = selectedTimestamp === cell.timestamp
              const isToday = todayTimestamp === cell.timestamp
              const isDisabled = isDayDisabled(cell.timestamp)

              return (
                <button
                  key={cell.timestamp}
                  type="button"
                  ref={(element) => {
                    if (element) {
                      dayButtonRefs.current.set(cell.timestamp, element)
                    } else {
                      dayButtonRefs.current.delete(cell.timestamp)
                    }
                  }}
                  tabIndex={cell.timestamp === activeDayTimestamp ? 0 : -1}
                  className={[
                    styles.dayCell,
                    cell.isCurrentMonth ? '' : styles.dayCellOutside,
                    cell.weekdayIndex === 0 ? styles.dayCellSunday : '',
                    cell.weekdayIndex === 6 ? styles.dayCellSaturday : '',
                    isToday ? styles.dayCellToday : '',
                    isSelected ? styles.dayCellSelected : '',
                    isDisabled ? styles.dayCellDisabled : '',
                  ].filter(Boolean).join(' ')}
                  disabled={isDisabled}
                  aria-pressed={isSelected}
                  aria-current={isToday ? 'date' : undefined}
                  aria-label={`${cell.year}년 ${cell.month}월 ${cell.day}일`}
                  onClick={() => commitSelection(cell.timestamp)}
                >
                  {cell.day}
                </button>
              )
            })}
          </div>

          <div className={styles.panelFooter}>
            <span className={styles.footerHint}>
              {selectedTimestamp !== null ? formatPickerDate(value) : '선택 없음'}
            </span>
            <div className={styles.footerActions}>
              <button
                type="button"
                className={styles.footerButton}
                onClick={() => commitSelection(todayTimestamp)}
                disabled={isDayDisabled(todayTimestamp)}
              >
                오늘
              </button>
              <button
                type="button"
                className={styles.footerButton}
                onClick={clearSelection}
                disabled={selectedTimestamp === null}
              >
                지우기
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}