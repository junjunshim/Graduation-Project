import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Icon, type IconName } from '../../../design-system/primitives/Icon'
import { getCurrentUser } from '../../auth/api'
import { WorkspaceTimelineTab } from '../components/WorkspaceTimelineTab'
import { formatWorkspaceMonthDay } from '../model/formatters'
import { getWorkItemStatusLabel, getWorkItemStatusTone } from '../model/labels'
import type { RoleMember, WorkItemRecord, WorkItemStatus, WorkspaceOverview } from '../model/types'
import { getWorkspaceOverview } from '../queries/workspaceOverview'
import styles from './WorkspacePage.module.css'

type WorkspaceStatusFilter = 'all' | WorkItemStatus

type WorkspaceMetric = {
  label: string
  value: string
  description: string
  icon?: IconName
  progress?: number
  variant?: 'primary' | 'standard'
}

type DueStatusTone = 'neutral' | 'soon' | 'overdue' | 'done'

type TimelineItem = {
  item: WorkItemRecord
  left: number
  width: number
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

type WorkspaceView = 'overview' | 'timeline'

type WorkspaceTab = {
  label: string
  to: string
  view?: WorkspaceView
}

const workspaceTabs: WorkspaceTab[] = [
  { label: '개요', to: '/workspace', view: 'overview' },
  { label: '업무', to: '/work-items' },
  { label: '타임라인', to: '/workspace?view=timeline', view: 'timeline' },
  { label: '문서', to: '/documents' },
  { label: '파일', to: '/files' },
  { label: '설정', to: '/settings' },
]

const MS_PER_DAY = 24 * 60 * 60 * 1000
const WORKSPACE_TIME_ZONE = 'Asia/Seoul'
const BOARD_ITEM_LIMIT = 5
const TIMELINE_ITEM_LIMIT = 5
const DOCUMENT_LIMIT = 3
const ACTIVITY_LIMIT = 6
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

  return Date.UTC(year, monthIndex, day)
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

function buildTimeline(workItems: WorkItemRecord[]): TimelineView {
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
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .slice(0, TIMELINE_ITEM_LIMIT)

  if (rangedItems.length === 0) {
    return {
      items: [],
      monthLabels: [{ align: 'start', label: '일정 미정', left: 0 }],
      showToday: false,
      ticks: [],
      todayLeft: 0,
    }
  }

  const rangeStart = Math.min(...rangedItems.map((item) => item.start))
  const rangeEnd = Math.max(...rangedItems.map((item) => item.end))
  const paddedStart = rangeStart - 2 * MS_PER_DAY
  const paddedEnd = rangeEnd + 2 * MS_PER_DAY
  const rangeSpan = Math.max(paddedEnd - paddedStart, MS_PER_DAY)
  const tickCount = 7
  const today = getWorkspaceTodayTimestamp()
  const rawTodayLeft = ((today - paddedStart) / rangeSpan) * 100
  const showToday = rawTodayLeft >= 0 && rawTodayLeft <= 100
  const todayLeft = showToday ? rawTodayLeft : 0
  const monthLabels = buildTimelineMonthLabels(paddedStart, paddedEnd, rangeSpan)

  return {
    monthLabels,
    showToday,
    todayLeft,
    ticks: buildTimelineTicks(paddedStart, rangeSpan, tickCount),
    items: rangedItems.map(({ item, start, end }) => {
      const left = ((start - paddedStart) / rangeSpan) * 100
      const clampedLeft = Math.min(100, Math.max(0, left))
      const width = Math.max(((end - start) / rangeSpan) * 100, MIN_TIMELINE_BAR_WIDTH)

      return {
        item,
        left: clampedLeft,
        width: Math.min(100 - clampedLeft, width),
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
  const teamMemberCount = Math.max(overview.rootRoleMembers.length, 1)

  return [
    {
      label: '진행률',
      value: `${averageProgress}%`,
      description: '전체 업무 기준',
      icon: 'trendingUp',
      progress: averageProgress,
      variant: 'primary',
    },
    {
      label: '전체 업무',
      value: String(overview.summary.workItemCount),
      description: `완료 ${counts.done} · 진행중 ${counts.inProgress} · 대기 ${counts.todo}`,
      icon: 'page',
    },
    {
      label: '마감 임박',
      value: String(overview.summary.dueSoonWorkItemCount),
      description: '7일 이내 마감',
      icon: 'alertTriangle',
    },
    {
      label: '팀원',
      value: String(teamMemberCount),
      description: '루트 공간 기준',
      icon: 'users',
    },
    {
      label: '내 업무',
      value: String(overview.summary.myWorkItemCount),
      description: '내 담당 업무',
      icon: 'checkSquare',
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

function getActivityDate(item: WorkItemRecord) {
  return formatWorkspaceMonthDay(item.createdAt)
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

function getActivityActionLabel(status: WorkItemStatus) {
  if (status === 'done') {
    return '완료 처리'
  }

  if (status === 'in-progress') {
    return '진행 업데이트'
  }

  return '대기 등록'
}

export function WorkspacePage() {
  const currentUser = getCurrentUser()
  const [searchParams] = useSearchParams()
  const [statusFilter, setStatusFilter] = useState<WorkspaceStatusFilter>('all')
  const activeView: WorkspaceView = searchParams.get('view') === 'timeline' ? 'timeline' : 'overview'

  if (!currentUser) {
    return null
  }

  const overview = getWorkspaceOverview(currentUser.userId)
  const counts = getWorkItemCounts(overview.visibleWorkItems)
  const metrics = getWorkspaceMetrics(overview)
  const filteredWorkItems = filterWorkItems(overview.visibleWorkItems, statusFilter).slice(0, BOARD_ITEM_LIMIT)
  const workspaceToday = getWorkspaceTodayTimestamp()
  const timeline = buildTimeline(overview.visibleWorkItems)
  const recentLinkedWorkItems = overview.recentWorkItems.slice(0, DOCUMENT_LIMIT)
  const activityItems = [...overview.visibleWorkItems]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, ACTIVITY_LIMIT)
  const visibleMembers =
    overview.rootRoleMembers.length > 0
      ? overview.rootRoleMembers.slice(0, 4)
      : [{ userId: currentUser.userId, name: currentUser.name, email: '', roleName: 'ADMIN' as const, assignmentId: 0 }]
  const extraMemberCount = Math.max(0, overview.rootRoleMembers.length - visibleMembers.length)
  const statusFilters: Array<{ id: WorkspaceStatusFilter; label: string; count: number }> = [
    { id: 'all', label: '전체', count: counts.all },
    { id: 'todo', label: 'To do', count: counts.todo },
    { id: 'in-progress', label: '진행중', count: counts.inProgress },
    { id: 'done', label: '완료', count: counts.done },
  ]

  return (
    <section
      className={[styles.page, activeView === 'timeline' ? styles.timelinePage : ''].filter(Boolean).join(' ')}
    >
      <div className={styles.workspaceNavBar}>
        <nav className={styles.workspaceTabs} aria-label="워크스페이스 보기">
          {workspaceTabs.map((tab) => {
            const isActive = tab.view === activeView

            return (
              <Link
                key={tab.label}
                to={tab.to}
                className={[styles.tabLink, isActive ? styles.tabLinkActive : ''].filter(Boolean).join(' ')}
                aria-current={isActive ? 'page' : undefined}
              >
                {tab.label}
              </Link>
            )
          })}
        </nav>

        <div className={styles.headerActions}>
          <div className={styles.memberStack} aria-label="워크스페이스 멤버">
            {visibleMembers.map((member) => (
              <span
                key={`${member.assignmentId}-${member.userId}`}
                aria-label={member.name}
                data-member-name={member.name}
              >
                <Icon name="user" size={15} />
              </span>
            ))}
            {extraMemberCount > 0 ? <strong data-member-name={`외 ${extraMemberCount}명`}>+{extraMemberCount}</strong> : null}
          </div>

          <button type="button" className={styles.secondaryAction}>
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
      ) : (
        <>
      {overview.summary.orgNodeCount === 0 ? (
        <section className={styles.emptyPanel}>
          <p className={styles.panelEyebrow}>Workspace Setup</p>
          <h3>공유 공간을 먼저 만들어 주세요.</h3>
          <p>팀이나 프로젝트 공간을 만들면 업무 보드와 타임라인을 워크스페이스 기준으로 묶어 볼 수 있습니다.</p>
          <Link to="/setup/top-node" className={styles.primaryAction}>
            공유 공간 만들기
          </Link>
        </section>
      ) : null}

      <section className={styles.metricGrid} aria-label="워크스페이스 요약">
        {metrics.map((metric) => (
          <article
            key={metric.label}
            className={[styles.metricCard, metric.variant === 'primary' ? styles.metricCardPrimary : '']
              .filter(Boolean)
              .join(' ')}
          >
            <div className={styles.metricHeader}>
              <span>{metric.label}</span>
              {metric.icon ? <Icon name={metric.icon} size={18} /> : null}
            </div>
            <strong>{metric.value}</strong>
            {typeof metric.progress === 'number' ? (
              <div className={styles.sketchProgress} aria-label={`진행률 ${metric.progress}%`}>
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
                <div className={styles.statusFilters} aria-label="업무 상태 필터">
                  {statusFilters.map((filter) => (
                    <button
                      key={filter.id}
                      type="button"
                      className={[styles.filterButton, statusFilter === filter.id ? styles.filterButtonActive : '']
                        .filter(Boolean)
                        .join(' ')}
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
                <span>업무명</span>
                <span>담당자</span>
                <span>마감일</span>
                <span>상태</span>
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
                        <Icon name="user" size={13} />
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
                      <strong>{item.title}</strong>
                      <small>{getTimelineRangeLabel(item)}</small>
                    </span>
                    <div className={styles.timelineTrack}>
                      <i className={getTimelineBarClassName(item.status)} style={{ left: `${left}%`, width: `${width}%` }} />
                    </div>
                  </Link>
                ))
              ) : (
                <p className={styles.emptyCopy}>일정이 등록된 업무가 없습니다.</p>
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
              {recentLinkedWorkItems.length > 0 ? (
                recentLinkedWorkItems.map((item) => (
                  <Link key={item.workItemId} to={`/work-items/${item.workItemId}`} className={styles.documentItem}>
                    <span className={styles.documentIcon}>
                      <Icon name="fileText" size={15} />
                    </span>
                    <span className={styles.documentCopy}>
                      <strong>{item.title}</strong>
                      <small>
                        {getMemberName(item.ownerUserId, overview.rootRoleMembers)} · {formatWorkspaceMonthDay(item.createdAt)}
                      </small>
                    </span>
                    <Icon name="arrowRight" size={14} />
                  </Link>
                ))
              ) : (
                <p className={styles.emptyCopy}>최근 연결된 업무가 없습니다.</p>
              )}
              <Link to="/documents" className={styles.addDocumentItem}>
                <span className={styles.documentIcon}>
                  <Icon name="plus" size={15} />
                </span>
                <span className={styles.documentCopy}>
                  <strong>새 문서 추가</strong>
                  <small>문서 탭으로 이동</small>
                </span>
              </Link>
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
              {activityItems.length > 0 ? (
                activityItems.map((item) => (
                  <Link key={item.workItemId} to={`/work-items/${item.workItemId}`} className={styles.activityItem}>
                    <span className={styles.activityAvatar}>
                      <Icon name="user" size={14} />
                    </span>
                    <span className={styles.activityCopy}>
                      <small>
                        {getActivityDate(item)} · {getActivityActionLabel(item.status)}
                      </small>
                      <strong>{item.title}</strong>
                      <span>{getMemberName(item.ownerUserId, overview.rootRoleMembers)}</span>
                    </span>
                    <span className={getStatusBadgeClassName(item.status)}>{getWorkItemStatusLabel(item.status)}</span>
                  </Link>
                ))
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
