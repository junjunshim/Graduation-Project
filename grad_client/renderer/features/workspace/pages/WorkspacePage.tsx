import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Icon, type IconName } from '../../../design-system/primitives/Icon'
import { UserAvatar } from '../../../design-system/primitives/UserAvatar'
import { getCurrentUser } from '../../auth/api'
import { WorkspaceFilesTab } from '../components/WorkspaceFilesTab'
import { WorkspaceMembersTab } from '../components/WorkspaceMembersTab'
import { WorkspaceRolesTab } from '../components/WorkspaceRolesTab'
import { WorkspaceTasksTab } from '../components/WorkspaceTasksTab'
import { WorkspaceTimelineTab } from '../components/WorkspaceTimelineTab'
import { fetchNodeDetail, getOrgSnapshot } from '../data/orgService'
import { subscribeToWorkspaceCache } from '../data/workspaceCacheEvents'
import {
  getActiveWorkspaceRootId,
  getDefaultWorkspaceRootId,
} from '../data/workspaceDirectorySelection'
import { formatActivityMessage } from '../../dashboard/model/activityFormatter'
import { formatWorkspaceMonthDay } from '../model/formatters'
import { getWorkItemStatusLabel, getWorkItemStatusTone } from '../model/labels'
import type { ActivityRecord, RoleMember, WorkItemRecord, WorkItemStatus, WorkspaceOverview } from '../model/types'
import { getWorkspaceOverview } from '../queries/workspaceOverview'
import styles from './WorkspacePage.module.css'

type WorkspaceStatusFilter = 'all' | WorkItemStatus

type WorkspaceMetric = {
  label: string
  value: string
  description: string
  icon?: IconName
  progress?: number
  tone?: 'brand' | 'warning' | 'info' | 'success' | 'purple' | 'amber'
  variant?: 'primary' | 'standard'
}

type DueStatusTone = 'neutral' | 'soon' | 'overdue' | 'done'

type TimelineItem = {
  item: WorkItemRecord
  left: number
  width: number
}

type WorkItemSchedule = {
  item: WorkItemRecord
  start: number
  end: number
}

type WorkItemScheduleState = 'current' | 'upcoming' | 'past'

type ActivityDisplay = {
  dateLabel: string
  actionLabel: string
}

type TimelineAxisLabel = {
  align: 'start' | 'center' | 'end'
  label: string
  left: number
}

type TimelineView = {
  items: TimelineItem[]
  monthLabels: TimelineAxisLabel[]
  ticks: TimelineAxisLabel[]
  showToday: boolean
  todayLeft: number
}

type WorkspaceView = 'overview' | 'tasks' | 'timeline' | 'files' | 'members' | 'roles'

type WorkspaceTab = {
  label: string
  to: string
  view?: WorkspaceView
}

const workspaceTabs: WorkspaceTab[] = [
  { label: '개요', to: '/workspace', view: 'overview' },
  { label: '업무', to: '/workspace?view=tasks', view: 'tasks' },
  { label: '타임라인', to: '/workspace?view=timeline', view: 'timeline' },
  { label: '파일', to: '/workspace?view=files', view: 'files' },
  { label: '사용자', to: '/workspace?view=members', view: 'members' },
  { label: '역할/권한', to: '/workspace?view=roles', view: 'roles' },
  { label: '설정', to: '/settings' },
]

const MS_PER_DAY = 24 * 60 * 60 * 1000
const WORKSPACE_TIME_ZONE = 'Asia/Seoul'
const BOARD_ITEM_LIMIT = 5
const TIMELINE_ITEM_LIMIT = 5
const TIMELINE_WINDOW_PAST_DAYS = 21
const TIMELINE_WINDOW_FUTURE_DAYS = 21
const TIMELINE_TICK_COUNT = 7
const DOCUMENT_LIMIT = 3
const ACTIVITY_LIMIT = 9
const MIN_TIMELINE_BAR_WIDTH = 2.4

function clampProgress(progress: number) {
  if (!Number.isFinite(progress)) {
    return 0
  }

  return Math.min(100, Math.max(0, Math.round(progress)))
}

function parseWorkspaceDay(value?: string) {
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

function formatMonthLabel(timestamp: number) {
  return new Intl.DateTimeFormat('ko-KR', {
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(timestamp))
}

function formatTickLabel(timestamp: number) {
  return new Intl.DateTimeFormat('ko-KR', {
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(timestamp))
}

function getAxisLabelAlign(left: number): TimelineAxisLabel['align'] {
  if (left <= 3) {
    return 'start'
  }

  if (left >= 97) {
    return 'end'
  }

  return 'center'
}

function getAxisLabelClassName(align: TimelineAxisLabel['align']) {
  return [
    styles.timelineAxisLabel,
    align === 'start' ? styles.timelineAxisLabelStart : align === 'end' ? styles.timelineAxisLabelEnd : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function buildTimelineTicks(rangeStart: number, rangeSpan: number, tickCount: number): TimelineAxisLabel[] {
  return Array.from({ length: tickCount }, (_, index) => {
    const left = (index / Math.max(1, tickCount - 1)) * 100

    return {
      align: getAxisLabelAlign(left),
      label: formatTickLabel(rangeStart + (rangeSpan / Math.max(1, tickCount - 1)) * index),
      left,
    }
  })
}

function buildTimelineMonthLabels(rangeStart: number, rangeEnd: number, rangeSpan: number): TimelineAxisLabel[] {
  const labels: TimelineAxisLabel[] = []
  const startDate = new Date(rangeStart)
  let cursor = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), 1)

  if (cursor < rangeStart) {
    cursor = rangeStart
  }

  while (cursor <= rangeEnd) {
    const left = ((cursor - rangeStart) / rangeSpan) * 100

    labels.push({
      align: getAxisLabelAlign(left),
      label: formatMonthLabel(cursor),
      left,
    })

    const cursorDate = new Date(cursor)
    cursor = Date.UTC(cursorDate.getUTCFullYear(), cursorDate.getUTCMonth() + 1, 1)
  }

  return labels.length > 0
    ? labels
    : [
        {
          align: 'start',
          label: formatMonthLabel(rangeStart),
          left: 0,
        },
      ]
}

function getWorkspaceTodayTimestamp() {
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

function getWorkItemSchedule(item: WorkItemRecord): WorkItemSchedule | null {
  const parsedStart = parseWorkspaceDay(item.startDate)
  const parsedEnd = parseWorkspaceDay(item.dueDate)
  const start = parsedStart ?? parsedEnd
  const end = parsedEnd ?? parsedStart

  if (start === null || end === null) {
    return null
  }

  return {
    item,
    start: Math.min(start, end),
    end: Math.max(start, end),
  }
}

function getWorkItemScheduleState(schedule: WorkItemSchedule, today: number): WorkItemScheduleState {
  if (schedule.start <= today && schedule.end >= today) {
    return 'current'
  }

  return schedule.start > today ? 'upcoming' : 'past'
}

function getWorkItemScheduleDistance(schedule: WorkItemSchedule, today: number) {
  const state = getWorkItemScheduleState(schedule, today)

  if (state === 'current') {
    return 0
  }

  return state === 'upcoming' ? schedule.start - today : today - schedule.end
}

function compareWorkItemFallback(left: WorkItemRecord, right: WorkItemRecord) {
  return (
    right.createdAt.localeCompare(left.createdAt) ||
    left.title.localeCompare(right.title, 'ko') ||
    left.workItemId.localeCompare(right.workItemId)
  )
}

function compareWorkItemSchedulesByToday(left: WorkItemSchedule, right: WorkItemSchedule, today: number) {
  const distanceOrder = getWorkItemScheduleDistance(left, today) - getWorkItemScheduleDistance(right, today)

  if (distanceOrder !== 0) {
    return distanceOrder
  }

  const leftState = getWorkItemScheduleState(left, today)
  const rightState = getWorkItemScheduleState(right, today)

  if (leftState === 'current' && rightState === 'current') {
    return left.end - right.end || right.start - left.start || compareWorkItemFallback(left.item, right.item)
  }

  if (leftState !== rightState) {
    return leftState === 'upcoming' ? -1 : 1
  }

  const dateOrder = leftState === 'upcoming' ? left.start - right.start : right.end - left.end
  return dateOrder || compareWorkItemFallback(left.item, right.item)
}

function sortWorkItemsByToday(workItems: WorkItemRecord[], today: number) {
  return workItems
    .map((item, index) => ({ index, item, schedule: getWorkItemSchedule(item) }))
    .sort((left, right) => {
      if (left.schedule && right.schedule) {
        return compareWorkItemSchedulesByToday(left.schedule, right.schedule, today) || left.index - right.index
      }

      if (left.schedule || right.schedule) {
        return left.schedule ? -1 : 1
      }

      return compareWorkItemFallback(left.item, right.item) || left.index - right.index
    })
    .map(({ item }) => item)
}

function buildTimeline(workItems: WorkItemRecord[], today: number): TimelineView {
  const rangeStart = today - TIMELINE_WINDOW_PAST_DAYS * MS_PER_DAY
  const rangeEnd = today + TIMELINE_WINDOW_FUTURE_DAYS * MS_PER_DAY
  const rangeSpan = Math.max(rangeEnd - rangeStart, MS_PER_DAY)
  const rangedItems = workItems
    .map((item) => {
      const start = parseWorkspaceDay(item.startDate) ?? parseWorkspaceDay(item.dueDate)
      const end = parseWorkspaceDay(item.dueDate) ?? (start ? start + 7 * MS_PER_DAY : null)

      if (start === null || end === null) {
        return null
      }

      return {
        item,
        start: Math.min(start, end),
        end: Math.max(start, end),
      }
    })
    .filter((item): item is { item: WorkItemRecord; start: number; end: number } => Boolean(item))
    .filter(({ start, end }) => end >= rangeStart && start <= rangeEnd)
    .sort((left, right) => compareWorkItemSchedulesByToday(left, right, today))
    .slice(0, TIMELINE_ITEM_LIMIT)
  const todayLeft = ((today - rangeStart) / rangeSpan) * 100
  const monthLabels = buildTimelineMonthLabels(rangeStart, rangeEnd, rangeSpan)

  return {
    monthLabels,
    showToday: true,
    todayLeft,
    ticks: buildTimelineTicks(rangeStart, rangeSpan, TIMELINE_TICK_COUNT),
    items: rangedItems.map(({ item, start, end }) => {
      const visibleStart = Math.max(start, rangeStart)
      const visibleEnd = Math.min(end, rangeEnd)
      const left = ((visibleStart - rangeStart) / rangeSpan) * 100
      const width = Math.max(((visibleEnd - visibleStart) / rangeSpan) * 100, MIN_TIMELINE_BAR_WIDTH)

      return {
        item,
        left,
        width: Math.min(100 - left, width),
      }
    }),
  }
}

function getStatusBadgeClassName(status: WorkItemStatus) {
  const tone = getWorkItemStatusTone(status)

  return [
    styles.statusBadge,
    tone === 'todo' ? styles.statusTodo : tone === 'inProgress' ? styles.statusInProgress : styles.statusDone,
  ].join(' ')
}

function getTimelineBarClassName(status: WorkItemStatus) {
  return [
    status === 'done' ? styles.timelineBarDone : status === 'in-progress' ? styles.timelineBarActive : styles.timelineBarTodo,
  ].join(' ')
}

function getDueBadgeClassName(tone: DueStatusTone) {
  return [
    styles.dueBadge,
    tone === 'done'
      ? styles.dueDone
      : tone === 'overdue'
        ? styles.dueOverdue
        : tone === 'soon'
          ? styles.dueSoon
          : styles.dueNeutral,
  ].join(' ')
}

function getWorkItemCounts(workItems: WorkItemRecord[]) {
  return {
    all: workItems.length,
    todo: workItems.filter((item) => item.status === 'todo').length,
    inProgress: workItems.filter((item) => item.status === 'in-progress').length,
    done: workItems.filter((item) => item.status === 'done').length,
  }
}

function getWorkspaceMetrics(overview: WorkspaceOverview): WorkspaceMetric[] {
  const counts = getWorkItemCounts(overview.visibleWorkItems)
  const averageProgress = clampProgress(overview.summary.averageProgress)
  const directMemberCount = overview.rootRoleMembers.length
  const totalMemberCount = overview.allRoleMembers ? overview.allRoleMembers.length : directMemberCount

  const memberValue =
    totalMemberCount !== directMemberCount && totalMemberCount > 0
      ? `${directMemberCount} / ${totalMemberCount}`
      : String(Math.max(directMemberCount, 1))

  const memberDescription =
    totalMemberCount !== directMemberCount && totalMemberCount > 0
      ? `직속 ${directMemberCount}명 · 전체 ${totalMemberCount}명`
      : '현재 워크스페이스 기준'

  return [
    {
      label: '진행률',
      value: `${averageProgress}%`,
      description: '전체 업무 기준',
      icon: 'trendingUp',
      progress: averageProgress,
      variant: 'primary',
      tone: 'brand',
    },
    {
      label: '전체 업무',
      value: String(overview.summary.workItemCount),
      description: `완료 ${counts.done} · 진행중 ${counts.inProgress} · 대기 ${counts.todo}`,
      icon: 'page',
      tone: 'info',
    },
    {
      label: '마감 임박',
      value: String(overview.summary.dueSoonWorkItemCount),
      description: '7일 이내 마감',
      icon: 'alertTriangle',
      tone: 'warning',
    },
    {
      label: '팀원',
      value: memberValue,
      description: memberDescription,
      icon: 'users',
      tone: 'purple',
    },
    {
      label: '내 업무',
      value: String(overview.summary.myWorkItemCount),
      description: '내 담당 업무',
      icon: 'checkSquare',
      tone: 'success',
    },
  ]
}

function filterWorkItems(workItems: WorkItemRecord[], filter: WorkspaceStatusFilter) {
  if (filter === 'all') {
    return workItems
  }

  return workItems.filter((item) => item.status === filter)
}

function getMemberName(userId: string, members: RoleMember[]) {
  return members.find((member) => member.userId === userId)?.name ?? userId
}

function getDocumentScheduleLabel(item: WorkItemRecord, todayTimestamp: number) {
  const schedule = getWorkItemSchedule(item)

  if (!schedule) {
    return `등록 ${formatWorkspaceMonthDay(item.createdAt)}`
  }

  const state = getWorkItemScheduleState(schedule, todayTimestamp)

  if (state === 'current' && item.dueDate) {
    return `마감 ${formatWorkspaceMonthDay(item.dueDate)}`
  }

  if (state === 'upcoming') {
    return `시작 ${formatWorkspaceMonthDay(item.startDate ?? item.dueDate)}`
  }

  if (state === 'past') {
    return `일정 종료 ${formatWorkspaceMonthDay(item.dueDate ?? item.startDate)}`
  }

  return `시작 ${formatWorkspaceMonthDay(item.startDate ?? item.dueDate)}`
}

function getActivityDisplay(item: WorkItemRecord, todayTimestamp: number): ActivityDisplay {
  const schedule = getWorkItemSchedule(item)

  if (!schedule) {
    return {
      dateLabel: formatWorkspaceMonthDay(item.createdAt),
      actionLabel: '등록',
    }
  }

  const state = getWorkItemScheduleState(schedule, todayTimestamp)

  if (state === 'current') {
    return {
      dateLabel: '오늘 기준',
      actionLabel: getWorkItemStatusLabel(item.status),
    }
  }

  if (state === 'upcoming') {
    return {
      dateLabel: formatWorkspaceMonthDay(item.startDate ?? item.dueDate),
      actionLabel: '시작 예정',
    }
  }

  return {
    dateLabel: formatWorkspaceMonthDay(item.dueDate ?? item.startDate),
    actionLabel: item.status === 'done' ? '일정 종료' : '마감 경과',
  }
}

function getDueStatus(item: WorkItemRecord, todayTimestamp: number): { label: string; tone: DueStatusTone } {
  if (item.status === 'done') {
    return { label: '완료됨', tone: 'done' }
  }

  const dueTimestamp = parseWorkspaceDay(item.dueDate)

  if (dueTimestamp === null) {
    return { label: '마감 미정', tone: 'neutral' }
  }

  const dayDistance = Math.round((dueTimestamp - todayTimestamp) / MS_PER_DAY)

  if (dayDistance < 0) {
    return { label: `${Math.abs(dayDistance)}일 지남`, tone: 'overdue' }
  }

  if (dayDistance === 0) {
    return { label: '오늘 마감', tone: 'soon' }
  }

  if (dayDistance <= 7) {
    return { label: `${dayDistance}일 남음`, tone: 'soon' }
  }

  return { label: '여유 있음', tone: 'neutral' }
}

function getTimelineRangeLabel(item: WorkItemRecord) {
  const startLabel = item.startDate ? formatWorkspaceMonthDay(item.startDate) : '시작 미정'
  const endLabel = item.dueDate ? formatWorkspaceMonthDay(item.dueDate) : '마감 미정'

  return `${startLabel} - ${endLabel}`
}

export function WorkspacePage() {
  const [snapshot, setSnapshot] = useState(() => getOrgSnapshot())
  const currentUser = getCurrentUser(snapshot)
  const [searchParams] = useSearchParams()
  const workspaceRootParam = searchParams.get('rootId') || searchParams.get('nodeId')
  const activeWorkspaceRootId =
    workspaceRootParam ??
    getActiveWorkspaceRootId(currentUser?.userId) ??
    getDefaultWorkspaceRootId(currentUser?.userId)
  const [statusFilter, setStatusFilter] = useState<WorkspaceStatusFilter>('all')
  const requestedView = searchParams.get('view')
  const activeView: WorkspaceView =
    requestedView === 'tasks' ||
    requestedView === 'timeline' ||
    requestedView === 'files' ||
    requestedView === 'members' ||
    requestedView === 'roles'
      ? requestedView
      : 'overview'

  const [isLoading, setIsLoading] = useState(false)
  const [errorInfo, setErrorInfo] = useState<string | null>(null)
  const [reloadTrigger, setReloadTrigger] = useState(0)

  useEffect(() => {
    let isSubscribed = true

    if (activeWorkspaceRootId) {
      const currentSnapshot = getOrgSnapshot()
      const hasNodeInSnapshot = currentSnapshot.nodes.some(
        (node) => String(node.id) === String(activeWorkspaceRootId),
      )

      // 캐시된 노드가 없는 첫 진입 시에만 스켈레톤/로딩 상태 활성화
      if (!hasNodeInSnapshot) {
        setIsLoading(true)
      }
      setErrorInfo(null)

      fetchNodeDetail(activeWorkspaceRootId)
        .then((latestSnapshot) => {
          if (isSubscribed) {
            setSnapshot(latestSnapshot)
            setErrorInfo(null)
          }
        })
        .catch((error) => {
          console.warn('[WorkspacePage] 노드 상세 데이터 조회 실패:', error)
          if (isSubscribed) {
            // 캐시 데이터조차 없는 경우 에러 화면 표시
            if (!hasNodeInSnapshot) {
              setErrorInfo(error instanceof Error ? error.message : '노드 상세 정보를 불러오지 못했습니다.')
            }
          }
        })
        .finally(() => {
          if (isSubscribed) {
            setIsLoading(false)
          }
        })
    } else {
      setSnapshot(getOrgSnapshot())
      setIsLoading(false)
      setErrorInfo(null)
    }

    // 캐시 변경 이벤트(다른 mutation 발생 시)에는 메모리/로컬 DB 스냅샷만 즉시 부드럽게 동기화
    const unsubscribe = subscribeToWorkspaceCache(() => {
      if (isSubscribed) {
        setSnapshot(getOrgSnapshot())
      }
    })

    return () => {
      isSubscribed = false
      unsubscribe()
    }
  }, [activeWorkspaceRootId, reloadTrigger])

  if (!currentUser) {
    return null
  }

  // 1. 첫 진입 로딩 화면
  if (isLoading) {
    return (
      <section className={styles.page}>
        <div className={styles.loadingStateContainer} role="status">
          <div className={styles.spinnerLarge} aria-hidden="true" />
          <p className={styles.loadingStateText}>워크스페이스 데이터를 불러오는 중입니다...</p>
        </div>
      </section>
    )
  }

  // 2. 진입 실패 에러 화면 (권한 없음, 서버 장애 등)
  if (errorInfo) {
    return (
      <section className={styles.page}>
        <div className={styles.errorStateContainer} role="alert">
          <Icon name="alertTriangle" size={40} className={styles.errorStateIcon} />
          <h2 className={styles.errorStateTitle}>워크스페이스 로드 실패</h2>
          <p className={styles.errorStateMessage}>{errorInfo}</p>
          <button
            type="button"
            className={styles.retryButton}
            onClick={() => setReloadTrigger((count) => count + 1)}
          >
            <Icon name="sparkles" size={16} />
            다시 시도
          </button>
        </div>
      </section>
    )
  }

  const overview = getWorkspaceOverview(currentUser.userId, snapshot, {
    rootNodeId: activeWorkspaceRootId,
    singleNodeOnly: true,
  })
  const counts = getWorkItemCounts(overview.visibleWorkItems)
  const metrics = getWorkspaceMetrics(overview)
  const workspaceToday = getWorkspaceTodayTimestamp()
  const todayRelevantWorkItems = sortWorkItemsByToday(overview.visibleWorkItems, workspaceToday)
  const filteredWorkItems = filterWorkItems(todayRelevantWorkItems, statusFilter).slice(0, BOARD_ITEM_LIMIT)
  const timeline = buildTimeline(overview.visibleWorkItems, workspaceToday)
  const todayLinkedWorkItems = todayRelevantWorkItems.slice(0, DOCUMENT_LIMIT)
  const displayedFiles = (overview.files ?? []).slice(0, DOCUMENT_LIMIT)
  const workItemsById = new Map(overview.visibleWorkItems.map((item) => [item.workItemId, item]))
  const displayedActivities: ActivityRecord[] = [...(overview.activities ?? [])]
    .sort((a, b) => {
      const timeDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      if (!Number.isNaN(timeDiff) && timeDiff !== 0) {
        return timeDiff
      }
      return b.id - a.id
    })
    .slice(0, ACTIVITY_LIMIT)
  const activityItems = todayRelevantWorkItems.slice(0, ACTIVITY_LIMIT)
  const displayRoleMembers = overview.rootRoleMembers.length > 0
    ? overview.rootRoleMembers
    : overview.allRoleMembers && overview.allRoleMembers.length > 0
      ? overview.allRoleMembers
      : [{ userId: currentUser.userId, name: currentUser.name, email: '', roleName: 'ADMIN' as const, assignmentId: 0 }]
  const visibleMembers = displayRoleMembers.slice(0, 4)
  const totalMemberCount = overview.allRoleMembers ? overview.allRoleMembers.length : overview.rootRoleMembers.length
  const extraMemberCount = Math.max(0, totalMemberCount - visibleMembers.length)
  const statusFilters: Array<{ id: WorkspaceStatusFilter; label: string; count: number }> = [
    { id: 'all', label: '전체', count: counts.all },
    { id: 'todo', label: '예정', count: counts.todo },
    { id: 'in-progress', label: '진행중', count: counts.inProgress },
    { id: 'done', label: '완료', count: counts.done },
  ]

  return (
    <section
      className={[
        styles.page,
        activeView === 'overview' ? styles.overviewPage : '',
        activeView === 'timeline' ? styles.timelinePage : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className={styles.workspaceNavBar}>
        <nav className={styles.workspaceTabs} aria-label="워크스페이스 보기">
          {workspaceTabs.map((tab) => {
            const isActive = tab.view === activeView
            const targetTo =
              workspaceRootParam && tab.to.startsWith('/workspace')
                ? tab.to.includes('?')
                  ? `${tab.to}&nodeId=${encodeURIComponent(workspaceRootParam)}`
                  : `${tab.to}?nodeId=${encodeURIComponent(workspaceRootParam)}`
                : tab.to

            return (
              <Link
                key={tab.label}
                to={targetTo}
                className={[styles.tabLink, isActive ? styles.tabLinkActive : ''].filter(Boolean).join(' ')}
                aria-current={isActive ? 'page' : undefined}
              >
                {tab.label}
              </Link>
            )
          })}
        </nav>

        <div className={styles.headerActions}>
          <div
            className={styles.memberStack}
            aria-label="워크스페이스 멤버"
            title={
              overview.allRoleMembers && overview.allRoleMembers.length !== overview.rootRoleMembers.length
                ? `직속 팀원 ${overview.rootRoleMembers.length}명 / 하위 포함 전체 ${totalMemberCount}명`
                : `팀원 ${totalMemberCount}명`
            }
          >
            {visibleMembers.map((member) => (
              <span
                key={`${member.assignmentId}-${member.userId}`}
                data-member-name={member.name}
              >
                <UserAvatar name={member.name} userId={member.userId} size="medium" />
                <span className={styles.memberName}>{member.name}</span>
              </span>
            ))}
            {extraMemberCount > 0 ? <strong data-member-name={`외 ${extraMemberCount}명 (전체 ${totalMemberCount}명)`}>+{extraMemberCount}</strong> : null}
          </div>

          <button type="button" className={styles.secondaryAction}>
            <Icon name="users" size={15} />
            공유
          </button>
          <button type="button" className={styles.iconAction} aria-label="더보기">
            <span className={styles.moreDots} aria-hidden="true" />
          </button>
        </div>
      </div>

      {activeView === 'timeline' ? (
        <WorkspaceTimelineTab
          workItems={overview.visibleWorkItems}
          nodes={overview.visibleNodes}
          members={overview.rootRoleMembers}
        />
      ) : activeView === 'tasks' ? (
        <WorkspaceTasksTab
          workItems={overview.visibleWorkItems}
          members={overview.rootRoleMembers}
        />
      ) : activeView === 'files' ? (
        <WorkspaceFilesTab
          workItems={overview.visibleWorkItems}
          files={overview.files}
        />
      ) : activeView === 'members' ? (
        <WorkspaceMembersTab
          rootNode={overview.rootNode}
          nodes={overview.visibleNodes}
          roles={snapshot.roles}
          users={snapshot.users}
          authorities={snapshot.authorities}
          rootRoleMembers={overview.rootRoleMembers}
          allRoleMembers={overview.allRoleMembers}
        />
      ) : activeView === 'roles' ? (
        <WorkspaceRolesTab
          rootNode={overview.rootNode}
          authorities={snapshot.authorities}
          roles={snapshot.roles}
          currentUserId={currentUser.userId}
          currentUser={currentUser}
        />
      ) : (
        <>
      <section className={styles.metricGrid} aria-label="워크스페이스 요약">
        {metrics.map((metric) => (
          <article
            key={metric.label}
            className={[
              styles.metricCard,
              metric.variant === 'primary' ? styles.metricCardPrimary : '',
              metric.tone === 'brand' ? styles.metricCardBrand : '',
              metric.tone === 'warning' ? styles.metricCardWarning : '',
              metric.tone === 'info' ? styles.metricCardInfo : '',
              metric.tone === 'success' ? styles.metricCardSuccess : '',
              metric.tone === 'purple' ? styles.metricCardPurple : '',
              metric.tone === 'amber' ? styles.metricCardAmber : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <div className={styles.metricHeader}>
              <span>{metric.label}</span>
              {metric.icon ? <Icon name={metric.icon} size={18} /> : null}
            </div>
            <strong>{metric.value}</strong>
            {typeof metric.progress === 'number' ? (
              <div
                className={styles.sketchProgress}
                role="progressbar"
                aria-label={metric.label}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={metric.progress}
              >
                <span style={{ width: `${metric.progress}%` }} />
              </div>
            ) : null}
            <p>{metric.description}</p>
          </article>
        ))}
      </section>

      <div className={styles.workspaceGrid}>
        <div className={styles.leftColumn}>
          <section className={[styles.panel, styles.boardPanel].join(' ')}>
            <div className={styles.panelHeader}>
              <div>
                <h3 className={styles.panelTitle}>업무 보드</h3>
                <div className={styles.statusFilters} role="group" aria-label="업무 상태 필터">
                  {statusFilters.map((filter) => (
                    <button
                      key={filter.id}
                      type="button"
                      className={[styles.filterButton, statusFilter === filter.id ? styles.filterButtonActive : '']
                        .filter(Boolean)
                        .join(' ')}
                      aria-pressed={statusFilter === filter.id}
                      onClick={() => setStatusFilter(filter.id)}
                    >
                      <span className={styles.filterButtonLabel}>
                        {filter.id === 'all' ? filter.label : `${filter.label} (${filter.count})`}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
              <Link to="/work-items/new" className={styles.roundAction}>
                <Icon name="plus" size={14} />
                <span>새 업무</span>
              </Link>
            </div>

            <div className={styles.workTable}>
              <div className={styles.workTableHeader} aria-hidden="true">
                <span className={styles.workTableHeaderCheck} />
                <span className={styles.workTableHeaderTitle}>업무명</span>
                <span className={styles.workTableHeaderAssignee}>담당자</span>
                <span className={styles.workTableHeaderDue}>마감일</span>
                <span className={styles.workTableHeaderStatus}>상태</span>
              </div>

              {filteredWorkItems.length > 0 ? (
                filteredWorkItems.map((item) => {
                  const dueStatus = getDueStatus(item, workspaceToday)

                  return (
                    <Link key={item.workItemId} to={`/work-items/${item.workItemId}`} className={styles.workRow}>
                    <span
                      className={[
                        styles.checkCell,
                        item.status === 'done' ? styles.checkCellDone : item.status === 'in-progress' ? styles.checkCellActive : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      aria-hidden="true"
                    >
                      {item.status === 'done' ? '✓' : ''}
                    </span>
                    <div className={styles.workTitleCell}>
                      <strong>{item.title}</strong>
                    </div>
                    <span className={styles.assigneeCell}>
                      <span className={styles.assigneeAvatar} aria-hidden="true">
                        <UserAvatar
                          name={getMemberName(item.ownerUserId, overview.rootRoleMembers)}
                          userId={item.ownerUserId}
                        />
                      </span>
                      <span>{getMemberName(item.ownerUserId, overview.rootRoleMembers)}</span>
                    </span>
                    <span className={styles.dueCell}>
                      <span>{formatWorkspaceMonthDay(item.dueDate)}</span>
                      <small className={getDueBadgeClassName(dueStatus.tone)}>{dueStatus.label}</small>
                    </span>
                    <span className={getStatusBadgeClassName(item.status)}>{getWorkItemStatusLabel(item.status)}</span>
                    </Link>
                  )
                })
              ) : (
                <p className={styles.emptyCopy}>선택한 상태에 표시할 업무가 없습니다.</p>
              )}
            </div>

            <Link to="/work-items" className={styles.panelFooterLink}>
              전체 업무 보기
              <Icon name="arrowRight" size={15} />
            </Link>
          </section>

          <section id="workspace-timeline" className={[styles.panel, styles.timelinePanel].join(' ')}>
            <div className={styles.panelHeader}>
              <h3 className={styles.panelTitle}>타임라인</h3>
              <Link to="/workspace?view=timeline" className={styles.textAction}>
                전체 보기
                <Icon name="arrowRight" size={14} />
              </Link>
            </div>

            <div className={styles.timelineMonthHeader} aria-hidden="true">
              <div className={styles.timelineMonthTrack}>
                {timeline.monthLabels.map((month) => (
                  <strong
                    key={`${month.label}-${month.left}`}
                    className={getAxisLabelClassName(month.align)}
                    style={{ left: `${month.left}%` }}
                  >
                    {month.label}
                  </strong>
                ))}
              </div>
            </div>
            <div className={styles.timelineScale} aria-hidden="true">
              <div className={styles.timelineScaleTrack}>
                {timeline.ticks.map((tick) => (
                  <span
                    key={`${tick.label}-${tick.left}`}
                    className={[styles.timelineScaleTick, getAxisLabelClassName(tick.align)].join(' ')}
                    style={{ left: `${tick.left}%` }}
                  >
                    {tick.label}
                  </span>
                ))}
              </div>
            </div>

            <div className={styles.timelineList}>
              {timeline.showToday ? (
                <span className={styles.todayLineTrack} aria-hidden="true">
                  <span className={styles.todayLine} style={{ left: `${timeline.todayLeft}%` }}>
                    오늘
                  </span>
                </span>
              ) : null}
              {timeline.items.length > 0 ? (
                timeline.items.map(({ item, left, width }) => (
                  <Link key={item.workItemId} to={`/work-items/${item.workItemId}`} className={styles.timelineItem}>
                    <span className={styles.timelineItemCopy}>
                      <strong title={item.title}>{item.title}</strong>
                      <small>{getTimelineRangeLabel(item)}</small>
                    </span>
                    <div className={styles.timelineTrack}>
                      <i className={getTimelineBarClassName(item.status)} style={{ left: `${left}%`, width: `${width}%` }} />
                    </div>
                  </Link>
                ))
              ) : (
                <p className={styles.emptyCopy}>오늘 전후 3주 안에 표시할 일정이 없습니다.</p>
              )}
            </div>
          </section>
        </div>

        <div className={styles.rightColumn}>
          <section className={[styles.panel, styles.documentsPanel].join(' ')}>
            <div className={styles.panelHeader}>
              <div>
                <h3 className={styles.panelTitle}>주요 문서</h3>
              </div>
              <Link to="/documents" className={styles.textAction}>
                문서 보기
                <Icon name="arrowRight" size={14} />
              </Link>
            </div>

            <div className={styles.documentList}>
              {displayedFiles.length > 0 ? (
                displayedFiles.map((file) => {
                  const parentWorkItem = workItemsById.get(file.workItemId)
                  const uploaderName = file.uploaderName || getMemberName(file.uploaderUserId, overview.rootRoleMembers)

                  return (
                    <Link key={file.id} to={`/work-items/${file.workItemId}`} className={styles.documentItem}>
                      <span className={styles.documentIcon}>
                        <Icon name="fileText" size={15} />
                      </span>
                      <span className={styles.documentCopy}>
                        <strong title={file.originalFileName}>{file.originalFileName}</strong>
                        {parentWorkItem ? (
                          <span className={styles.documentWorkItemTitle} title={parentWorkItem.title}>
                            {parentWorkItem.title}
                          </span>
                        ) : null}
                        <small title={`${uploaderName} · ${formatWorkspaceMonthDay(file.createdAt)}`}>
                          {uploaderName} · {formatWorkspaceMonthDay(file.createdAt)}
                        </small>
                      </span>
                      <Icon name="arrowRight" size={14} />
                    </Link>
                  )
                })
              ) : todayLinkedWorkItems.length > 0 ? (
                todayLinkedWorkItems.map((item) => (
                  <Link key={item.workItemId} to={`/work-items/${item.workItemId}`} className={styles.documentItem}>
                    <span className={styles.documentIcon}>
                      <Icon name="fileText" size={15} />
                    </span>
                    <span className={styles.documentCopy}>
                      <strong>{item.title}</strong>
                      <small>
                        {getMemberName(item.ownerUserId, overview.rootRoleMembers)} ·{' '}
                        {getDocumentScheduleLabel(item, workspaceToday)}
                      </small>
                    </span>
                    <Icon name="arrowRight" size={14} />
                  </Link>
                ))
              ) : (
                <p className={styles.emptyCopy}>최근 공유된 문서가 없습니다.</p>
              )}
            </div>
          </section>

          <section className={[styles.panel, styles.activityPanel].join(' ')}>
            <div className={styles.panelHeader}>
              <div>
                <h3 className={styles.panelTitle}>최근 활동</h3>
              </div>
              <Link to="/work-items" className={styles.textAction}>
                업무 보기
                <Icon name="arrowRight" size={14} />
              </Link>
            </div>

            <div className={styles.activityList}>
              {displayedActivities.length > 0 ? (
                displayedActivities.map((act) => {
                  const message = formatActivityMessage(act)
                  const targetWorkItemId = act.entityType.toUpperCase() === 'WORK_ITEM' ? act.entityId : undefined

                  const content = (
                    <>
                      <span className={styles.activityAvatar}>
                        <UserAvatar
                          name={act.actorName || getMemberName(act.actorUserId, overview.rootRoleMembers)}
                          userId={act.actorUserId}
                          size="medium"
                        />
                      </span>
                      <span className={styles.activityCopy}>
                        <strong title={message}>{message}</strong>
                        <small>{formatWorkspaceMonthDay(act.createdAt)}</small>
                      </span>
                    </>
                  )

                  return targetWorkItemId ? (
                    <Link key={act.id} to={`/work-items/${targetWorkItemId}`} className={styles.activityItem}>
                      {content}
                    </Link>
                  ) : (
                    <div key={act.id} className={styles.activityItem}>
                      {content}
                    </div>
                  )
                })
              ) : activityItems.length > 0 ? (
                activityItems.map((item) => {
                  const activityDisplay = getActivityDisplay(item, workspaceToday)

                  return (
                    <Link key={item.workItemId} to={`/work-items/${item.workItemId}`} className={styles.activityItem}>
                      <span className={styles.activityAvatar}>
                        <UserAvatar
                          name={getMemberName(item.ownerUserId, overview.rootRoleMembers)}
                          userId={item.ownerUserId}
                          size="medium"
                        />
                      </span>
                      <span className={styles.activityCopy}>
                        <small>
                          {activityDisplay.dateLabel} · {activityDisplay.actionLabel}
                        </small>
                        <strong>{item.title}</strong>
                        <span>{getMemberName(item.ownerUserId, overview.rootRoleMembers)}</span>
                      </span>
                      <span className={getStatusBadgeClassName(item.status)}>{getWorkItemStatusLabel(item.status)}</span>
                    </Link>
                  )
                })
              ) : (
                <p className={styles.emptyCopy}>표시할 활동이 없습니다.</p>
              )}
            </div>
          </section>
        </div>
      </div>
        </>
      )}
    </section>
  )
}
