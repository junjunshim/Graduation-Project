import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import { useDashboardContext } from '../../dashboard/data/useDashboardContext'
import { readDateKey, resolveTodayDate, toDateKey } from '../../dashboard/model/dashboardSummary'
import type { DashboardRecurringRule, DashboardWorkItem } from '../../dashboard/model/dashboardTypes'
import { TaskFilterDropdown } from '../../workspace/components/TaskFilterDropdown'
import { getOrgSnapshot } from '../../workspace/data/orgService'
import {
  getCategoryBadgeStyle,
  getRecurringCategoryLabel,
  getWorkItemPriorityMeta,
  getWorkItemStatusLabel,
} from '../../workspace/model/labels'
import { formatRepeatSummary } from '../../workspace/model/recurringSchedule'
import { getWorkItemTag } from '../../workspace/model/workItemTags'
import { NotificationPopover } from '../../notification/ui/NotificationPopover'
import {
  CalendarDetailDrawer,
  type CalendarDetailAction,
  type CalendarDetailAttachment,
  type CalendarDetailRow,
} from '../components/CalendarDetailDrawer'
import {
  CALENDAR_WEEKDAY_LABELS,
  buildMonthCells,
  getCalendarRangeState,
  formatCalendarDateTime,
  formatCalendarFullDate,
  formatCalendarTimeRange,
  formatMonthLabel,
  shiftMonth,
  startOfMonth,
} from '../model/calendarSummary'
import type { CalendarChip, CalendarSelection } from '../model/calendarTypes'
import styles from './CalendarPage.module.css'

const EMPTY_WORK_ITEMS: DashboardWorkItem[] = []
const EMPTY_RECURRING_RULES: DashboardRecurringRule[] = []

const LOADING_MESSAGE = '캘린더를 불러오는 중입니다.'
const FALLBACK_ERROR_MESSAGE = '캘린더 정보를 불러오지 못했습니다.'

/** 워크스페이스 필터의 '전체' 값 */
const ALL_WORKSPACES = 'all'

/** 퇴장 애니메이션이 끝나지 않아도 드로어를 정리하기 위한 대기 시간(ms) */
const DRAWER_EXIT_FALLBACK_MS = 220

function formatFileSize(bytes: number) {
  if (!bytes || bytes <= 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB']
  const unitIndex = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  return parseFloat((bytes / Math.pow(1024, unitIndex)).toFixed(1)) + ' ' + units[unitIndex]
}

/** 업무의 기간을 '2026-05-11 (월) ~ 2026-05-15 (금)' 형태로 만든다. */
function formatWorkItemPeriod(item: DashboardWorkItem, fallbackDateKey: string) {
  const startKey = readDateKey(item.startDate)
  const dueKey = readDateKey(item.dueDate)

  if (startKey && dueKey && startKey !== dueKey) {
    return formatCalendarFullDate(startKey) + ' ~ ' + formatCalendarFullDate(dueKey)
  }

  if (dueKey) return formatCalendarFullDate(dueKey)
  if (startKey) return formatCalendarFullDate(startKey)
  return formatCalendarFullDate(fallbackDateKey)
}

/** 셸(AppShell)이 Outlet context 로 넘겨주는 툴바 자리 */
type CalendarShellContext = {
  calendarToolbarRef?: { current: HTMLDivElement | null }
}

type CalendarChipButtonProps = {
  chip: CalendarChip
  dateKey: string
  /** 지금 선택된 항목(기간 하이라이트 대상)인지 */
  selected?: boolean
  onSelect: (chip: CalendarChip, dateKey: string) => void
}

function CalendarChipButton({ chip, dateKey, onSelect, selected = false }: CalendarChipButtonProps) {
  return (
    <button
      type="button"
      className={styles.chip}
      data-tone={chip.tone}
      data-selected={selected ? 'true' : undefined}
      title={chip.timeLabel ? chip.timeLabel + ' ' + chip.title : chip.title}
      onClick={() => onSelect(chip, dateKey)}
    >
      <span className={styles.chipMarker} aria-hidden="true" />
      {chip.timeLabel ? <span className={styles.chipTime}>{chip.timeLabel}</span> : null}
      {chip.kind === 'due' ? <span className={styles.chipKind}>마감</span> : null}
      {chip.kind === 'start' ? <span className={styles.chipKind}>시작</span> : null}
      <span className={styles.chipTitle}>{chip.title}</span>
    </button>
  )
}

export function CalendarPage() {
  const { status, context, error, reload } = useDashboardContext()
  const navigate = useNavigate()
  // null 이면 오늘이 속한 달을 보고 있다는 뜻이다.
  const [month, setMonth] = useState<Date | null>(null)
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({})
  const [selection, setSelection] = useState<CalendarSelection | null>(null)
  // 드로어 퇴장 애니메이션이 끝날 때까지 마지막 내용을 유지한다.
  const [isDrawerClosing, setIsDrawerClosing] = useState(false)
  // 'all' 이면 스코프 전체, 아니면 해당 워크스페이스(ownerNodeId)만 본다.
  const [workspaceFilter, setWorkspaceFilter] = useState<string>(ALL_WORKSPACES)
  const { calendarToolbarRef } = useOutletContext<CalendarShellContext>() ?? {}
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null)

  const workItems = context?.workItems ?? EMPTY_WORK_ITEMS
  const recurringRules = context?.recurringRules ?? EMPTY_RECURRING_RULES
  const today = useMemo(() => resolveTodayDate(context?.viewer?.today ?? null), [context])
  const visibleMonth = useMemo(() => month ?? startOfMonth(today), [month, today])
  const monthLabel = formatMonthLabel(visibleMonth)
  const orgSnapshot = useMemo(() => getOrgSnapshot(), [])

  // 노드(워크스페이스) 이름: API 가 준 이름 우선, 없으면 조직 스냅샷에서 찾는다.
  const resolveNodeName = useCallback(
    (nodeId: number, nodeTitle: string | null | undefined) =>
      nodeTitle?.trim() ||
      orgSnapshot.nodes.find((node) => node.id === nodeId)?.name ||
      `워크스페이스 ${nodeId}`,
    [orgSnapshot],
  )

  // 달력에 실제로 등장하는 워크스페이스만 필터 후보로 만든다.
  const workspaceOptions = useMemo(() => {
    const workspaces = new Map<number, string>()

    const collect = (nodeId: number, nodeTitle: string | null) => {
      if (workspaces.has(nodeId)) return

      workspaces.set(nodeId, resolveNodeName(nodeId, nodeTitle))
    }

    workItems.forEach((item) => collect(item.ownerNodeId, item.nodeTitle))
    recurringRules.forEach((rule) => collect(rule.ownerNodeId, rule.nodeTitle))

    return [
      { value: ALL_WORKSPACES, label: '전체 워크스페이스' },
      ...Array.from(workspaces.entries())
        .sort((left, right) => left[1].localeCompare(right[1], 'ko'))
        .map(([nodeId, name]) => ({ value: String(nodeId), label: name })),
    ]
  }, [workItems, recurringRules, resolveNodeName])

  const activeWorkspaceId = workspaceFilter === ALL_WORKSPACES ? null : Number(workspaceFilter)
  const filteredWorkItems = useMemo(
    () =>
      activeWorkspaceId === null
        ? workItems
        : workItems.filter((item) => item.ownerNodeId === activeWorkspaceId),
    [workItems, activeWorkspaceId],
  )
  const filteredRules = useMemo(
    () =>
      activeWorkspaceId === null
        ? recurringRules
        : recurringRules.filter((rule) => rule.ownerNodeId === activeWorkspaceId),
    [recurringRules, activeWorkspaceId],
  )

  const cells = useMemo(
    () => buildMonthCells(visibleMonth, filteredWorkItems, filteredRules, today),
    [visibleMonth, filteredWorkItems, filteredRules, today],
  )

  // 셸 헤더에 마련된 자리로 툴바를 옮겨, 달력이 세로 공간을 온전히 쓴다.
  useLayoutEffect(() => {
    setToolbarHost(calendarToolbarRef?.current ?? null)
  }, [calendarToolbarRef])

  const handleWorkspaceFilterChange = useCallback((value: string) => {
    setWorkspaceFilter(value)
    setIsDrawerClosing(false)
    setSelection(null)
  }, [])

  const handleShiftMonth = useCallback(
    (delta: number) => {
      setMonth(shiftMonth(visibleMonth, delta))
    },
    [visibleMonth],
  )

  const handleGoToday = useCallback(() => {
    setMonth(startOfMonth(today))
  }, [today])

  const toggleDay = useCallback((dateKey: string) => {
    setExpandedDays((previous) => ({ ...previous, [dateKey]: !previous[dateKey] }))
  }, [])

  const handleChipSelect = useCallback((chip: CalendarChip, dateKey: string) => {
    setIsDrawerClosing(false)

    if (chip.kind === 'schedule') {
      if (chip.ruleId != null) {
        setSelection({ kind: 'schedule', ruleId: chip.ruleId, dateKey })
      }
      return
    }

    if (chip.workItemId) {
      setSelection({ kind: 'workItem', workItemId: chip.workItemId, reason: chip.kind, dateKey })
    }
  }, [])

  const selectedWorkItem = useMemo(
    () =>
      selection?.kind === 'workItem'
        ? workItems.find((item) => item.workItemId === selection.workItemId) ?? null
        : null,
    [selection, workItems],
  )
  const selectedRule = useMemo(
    () =>
      selection?.kind === 'schedule'
        ? recurringRules.find((rule) => rule.ruleId === selection.ruleId) ?? null
        : null,
    [selection, recurringRules],
  )
  // 상세 드로어가 열려 있을 때만 로컬 스냅샷(권한/첨부파일)을 읽는다.
  const snapshot = useMemo(() => (selection ? getOrgSnapshot() : null), [selection])

  // 선택한 업무의 기간(시작~마감)을 달력에 표시한다. 일정은 그날 하루만 표시한다.
  const highlightRange = useMemo(() => {
    if (selectedWorkItem) {
      const startKey = readDateKey(selectedWorkItem.startDate) ?? readDateKey(selectedWorkItem.dueDate)
      const endKey = readDateKey(selectedWorkItem.dueDate) ?? startKey

      return { workItemId: selectedWorkItem.workItemId, ruleId: null, startKey, endKey }
    }

    if (selection?.kind === 'schedule') {
      return {
        workItemId: null,
        ruleId: selection.ruleId,
        startKey: selection.dateKey,
        endKey: selection.dateKey,
      }
    }

    return null
  }, [selectedWorkItem, selection])

  const isEntrySelected = useCallback(
    (chip: CalendarChip) =>
      highlightRange !== null &&
      ((chip.workItemId != null && chip.workItemId === highlightRange.workItemId) ||
        (chip.ruleId != null && chip.ruleId === highlightRange.ruleId)),
    [highlightRange],
  )

  const hasSelection = Boolean(selectedWorkItem || selectedRule)

  // 닫기는 애니메이션을 먼저 재생하고, 끝난 뒤 실제 선택을 해제한다.
  const closeDrawer = useCallback(() => setIsDrawerClosing(true), [])

  const handleDrawerExited = useCallback(() => {
    setIsDrawerClosing(false)
    setSelection(null)
  }, [])

  // 애니메이션이 재생되지 않는 환경(모션 최소화 등)을 위한 안전장치.
  useEffect(() => {
    if (!isDrawerClosing) return undefined

    const timer = window.setTimeout(handleDrawerExited, DRAWER_EXIT_FALLBACK_MS)
    return () => window.clearTimeout(timer)
  }, [isDrawerClosing, handleDrawerExited])

  const attachments = useMemo<CalendarDetailAttachment[]>(() => {
    if (!selectedWorkItem || !snapshot) return []

    return (snapshot.files ?? [])
      .filter((file) => file.workItemId === selectedWorkItem.workItemId && !file.isDeleted)
      .map((file) => ({
        id: String(file.id),
        name: file.originalFileName,
        sizeLabel: formatFileSize(file.fileSize),
      }))
  }, [selectedWorkItem, snapshot])

  const drawerRows = useMemo<CalendarDetailRow[]>(() => {
    if (selectedWorkItem) {
      const assignee =
        snapshot?.users.find((user) => user.userId === selectedWorkItem.ownerUserId)?.name ??
        context?.viewer?.name ??
        selectedWorkItem.ownerUserId
      const priority = getWorkItemPriorityMeta(selectedWorkItem.priority)
      const tag = getWorkItemTag(selectedWorkItem)

      return [
        {
          key: 'node',
          icon: 'orgChart',
          label: '워크스페이스',
          value: resolveNodeName(selectedWorkItem.ownerNodeId, selectedWorkItem.nodeTitle),
        },
        { key: 'assignee', icon: 'user', label: '담당자', value: assignee },
        {
          key: 'period',
          icon: 'calendar',
          label: '일정',
          value: formatWorkItemPeriod(selectedWorkItem, selection?.dateKey ?? toDateKey(today)),
        },
        {
          key: 'priority',
          icon: 'trendingUp',
          label: '우선순위',
          value: priority.label + ' ' + priority.symbol,
        },
        {
          key: 'status',
          icon: 'checkCircle',
          label: '상태',
          value: getWorkItemStatusLabel(selectedWorkItem.status),
        },
        {
          key: 'category',
          icon: 'folder',
          label: '카테고리',
          value: tag ? (
            <span className={styles.categoryBadge} style={getCategoryBadgeStyle(tag.label)}>
              {tag.label}
            </span>
          ) : (
            '-'
          ),
        },
      ]
    }

    if (selectedRule && selection?.kind === 'schedule') {
      const assignee = selectedRule.assigneeUserId
        ? snapshot?.users.find((user) => user.userId === selectedRule.assigneeUserId)?.name ??
          selectedRule.assigneeUserId
        : '미지정 (공용)'

      return [
        {
          key: 'node',
          icon: 'orgChart',
          label: '워크스페이스',
          value: resolveNodeName(selectedRule.ownerNodeId, selectedRule.nodeTitle),
        },
        { key: 'assignee', icon: 'user', label: '담당자', value: assignee },
        {
          key: 'date',
          icon: 'calendar',
          label: '일정',
          value: formatCalendarFullDate(selection.dateKey),
        },
        {
          key: 'time',
          icon: 'clock',
          label: '시간',
          value: formatCalendarTimeRange(selectedRule.startTime, selectedRule.durationMinutes),
        },
        { key: 'repeat', icon: 'repeat', label: '반복', value: formatRepeatSummary(selectedRule) },
        {
          key: 'category',
          icon: 'folder',
          label: '카테고리',
          value: getRecurringCategoryLabel(selectedRule.category),
        },
      ]
    }

    return []
  }, [selectedWorkItem, selectedRule, selection, snapshot, context, today, resolveNodeName])

  // 드로어에서는 수정/삭제 대신 원본 상세 화면으로 보낸다.
  const drawerActions = useMemo<CalendarDetailAction[]>(() => {
    if (selectedWorkItem) {
      return [
        {
          key: 'detail',
          label: '상세로 이동',
          icon: 'arrowRight',
          onClick: () => navigate('/work-items/' + selectedWorkItem.workItemId),
        },
      ]
    }

    if (selectedRule) {
      return [
        {
          key: 'detail',
          label: '상세로 이동',
          icon: 'arrowRight',
          onClick: () =>
            navigate(
              '/workspace?view=schedules&nodeId=' +
                selectedRule.ownerNodeId +
                '&ruleId=' +
                selectedRule.ruleId,
            ),
        },
      ]
    }

    return []
  }, [selectedWorkItem, selectedRule, navigate])

  // 툴바는 셸 헤더 자리로 옮겨 그린다(자리가 없으면 페이지 안에 그린다).
  const toolbarNode = (
    <div className={styles.toolbar}>
      <div className={styles.nav}>
        <button
          className={styles.navButton}
          type="button"
          aria-label="이전 달"
          onClick={() => handleShiftMonth(-1)}
        >
          <Icon name="chevronLeft" size={16} />
        </button>
        <h2 className={styles.monthLabel}>{monthLabel}</h2>
        <button
          className={styles.navButton}
          type="button"
          aria-label="다음 달"
          onClick={() => handleShiftMonth(1)}
        >
          <Icon name="chevronRight" size={16} />
        </button>
      </div>

      <div className={styles.actions}>
        <button className={styles.todayButton} type="button" onClick={handleGoToday}>
          오늘
        </button>

        <div className={styles.filter}>
          <TaskFilterDropdown
            label="워크스페이스"
            hideLabel
            value={workspaceFilter}
            options={workspaceOptions}
            onChange={handleWorkspaceFilterChange}
          />
        </div>

        {context?.viewer?.userId ? (
          <NotificationPopover userId={context.viewer.userId} buttonClassName={styles.bellButton} />
        ) : null}
      </div>
    </div>
  )

  if (status === 'loading') {
    return (
      <section className={styles.page + ' ' + styles.pageState}>
        <div className={styles.stateCard} aria-busy="true" aria-live="polite">
          <span className={styles.spinner} aria-hidden="true" />
          <p className={styles.stateMessage}>{LOADING_MESSAGE}</p>
        </div>
      </section>
    )
  }

  if (status === 'error') {
    return (
      <section className={styles.page + ' ' + styles.pageState}>
        <div className={styles.stateCard} role="alert">
          <Icon name="alertTriangle" size={22} className={styles.stateIcon} />
          <p className={styles.stateMessage}>{error ?? FALLBACK_ERROR_MESSAGE}</p>
          <button className={styles.retryButton} type="button" onClick={reload}>
            다시 시도
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className={styles.page}>
      {toolbarHost ? createPortal(toolbarNode, toolbarHost) : toolbarNode}

      <div className={styles.board}>
        <div className={styles.calendarColumn}>
          <div className={styles.weekdayRow}>
            {CALENDAR_WEEKDAY_LABELS.map((label, index) => (
              <span
                key={label}
                className={styles.weekdayCell}
                data-sunday={index === 0}
                data-saturday={index === 6}
              >
                {label}
              </span>
            ))}
          </div>

          <div className={styles.grid} role="grid" aria-label={monthLabel + ' 달력'}>
            {cells.map((cell) => {
              const isExpanded = expandedDays[cell.key] === true

              return (
                <div
                  key={cell.key}
                  className={styles.cell}
                  data-outside={!cell.isCurrentMonth}
                  data-today={cell.isToday}
                  data-sunday={cell.isSunday}
                  data-saturday={cell.isSaturday}
                  data-range={
                    getCalendarRangeState(
                      cell.key,
                      highlightRange?.startKey ?? null,
                      highlightRange?.endKey ?? null,
                    ) ?? undefined
                  }
                >
                  <span className={styles.dayNumber}>{cell.dayNumber}</span>

                  <div className={styles.cellBody}>
                    {cell.schedules.map((chip) => (
                      <CalendarChipButton
                        key={chip.key}
                        chip={chip}
                        selected={isEntrySelected(chip)}
                        dateKey={cell.key}
                        onSelect={handleChipSelect}
                      />
                    ))}

                    {cell.events.map((chip) => (
                      <CalendarChipButton
                        key={chip.key}
                        chip={chip}
                        selected={isEntrySelected(chip)}
                        dateKey={cell.key}
                        onSelect={handleChipSelect}
                      />
                    ))}

                    {cell.ongoing.length > 0 ? (
                      <>
                        <button
                          type="button"
                          className={styles.ongoingToggle}
                          aria-expanded={isExpanded}
                          onClick={() => toggleDay(cell.key)}
                        >
                          <Icon name={isExpanded ? 'chevronDown' : 'chevronRight'} size={13} />
                          <span>진행 중 {cell.ongoing.length}건</span>
                        </button>

                        {isExpanded ? (
                          <ul className={styles.ongoingList}>
                            {cell.ongoing.map((item) => (
                              <li key={item.key}>
                                <button
                                  type="button"
                                  className={styles.ongoingItem}
                                  data-selected={
                                    highlightRange?.workItemId === item.workItemId ? 'true' : undefined
                                  }
                                  title={item.title}
                                  onClick={() =>
                                    setSelection({
                                      kind: 'workItem',
                                      workItemId: item.workItemId,
                                      reason: 'ongoing',
                                      dateKey: cell.key,
                                    })
                                  }
                                >
                                  <span className={styles.chipMarker} aria-hidden="true" />
                                  <span className={styles.chipTitle}>{item.title}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {hasSelection ? (
          <div className={styles.detailColumn} data-closing={isDrawerClosing ? 'true' : undefined}>
            <CalendarDetailDrawer
              isOpen={hasSelection || isDrawerClosing}
              closing={isDrawerClosing}
              badgeLabel={selectedWorkItem ? '업무 상세' : '일정 상세'}
              badgeTone={selectedWorkItem ? 'brand' : 'info'}
              title={selectedWorkItem?.title ?? selectedRule?.title ?? ''}
              rows={drawerRows}
              description={selectedWorkItem?.description ?? selectedRule?.description ?? null}
              attachments={attachments}
              attachmentsTitle={selectedWorkItem ? '첨부파일' : '공통 양식 파일'}
              actions={drawerActions}
              createdAt={formatCalendarDateTime(selectedWorkItem?.createdAt ?? selectedRule?.createdAt)}
              updatedAt={formatCalendarDateTime(selectedWorkItem?.updatedAt ?? selectedRule?.updatedAt)}
              docked
              onClose={closeDrawer}
              onExited={handleDrawerExited}
            />
          </div>
        ) : null}
      </div>
    </section>
  )
}
