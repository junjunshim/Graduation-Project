import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon, type IconName } from '../../../design-system/primitives/Icon'
import { getCurrentUser } from '../../auth/api'
import { formatWorkspaceMonthDay } from '../model/formatters'
import { getWorkItemStatusLabel, getWorkItemStatusTone } from '../model/labels'
import type { RoleMember, WorkItemRecord, WorkItemStatus, WorkspaceOverview } from '../model/types'
import { getWorkspaceOverview } from '../queries/workspaceOverview'
import styles from './WorkspacePage.module.css'

type WorkspaceStatusFilter = 'all' | WorkItemStatus | 'review'

type WorkspaceMetric = {
  label: string
  value: string
  description: string
  icon?: IconName
  progress?: number
}

type TimelineItem = {
  item: WorkItemRecord
  left: number
  width: number
}

type TimelineView = {
  items: TimelineItem[]
  monthLabels: string[]
  ticks: string[]
  todayLeft: number
}

type WorkspaceTab =
  | {
      label: string
      to: string
      href?: never
    }
  | {
      label: string
      href: string
      to?: never
    }

const workspaceTabs: WorkspaceTab[] = [
  { label: '개요', to: '/workspace' },
  { label: '업무', to: '/work-items' },
  { label: '타임라인', href: '#workspace-timeline' },
  { label: '문서', to: '/documents' },
  { label: '파일', to: '/files' },
  { label: '설정', to: '/settings' },
]

const MS_PER_DAY = 24 * 60 * 60 * 1000
const BOARD_ITEM_LIMIT = 6
const TIMELINE_ITEM_LIMIT = 5
const DOCUMENT_LIMIT = 3

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
      monthLabels: ['일정 미정'],
      ticks: [],
      todayLeft: 62,
    }
  }

  const rangeStart = Math.min(...rangedItems.map((item) => item.start))
  const rangeEnd = Math.max(...rangedItems.map((item) => item.end))
  const paddedStart = rangeStart - 2 * MS_PER_DAY
  const paddedEnd = rangeEnd + 2 * MS_PER_DAY
  const rangeSpan = Math.max(paddedEnd - paddedStart, MS_PER_DAY)
  const tickCount = 7
  const today = Date.now()
  const rawTodayLeft = ((today - paddedStart) / rangeSpan) * 100
  const todayLeft = rawTodayLeft >= 0 && rawTodayLeft <= 100 ? rawTodayLeft : 62
  const monthLabels = Array.from(new Set([formatMonthLabel(paddedStart), formatMonthLabel(paddedEnd)]))

  return {
    monthLabels,
    todayLeft,
    ticks: Array.from({ length: tickCount }, (_, index) =>
      formatTickLabel(paddedStart + (rangeSpan / Math.max(1, tickCount - 1)) * index),
    ),
    items: rangedItems.map(({ item, start, end }) => {
      const left = ((start - paddedStart) / rangeSpan) * 100
      const width = Math.max(((end - start) / rangeSpan) * 100, 8)

      return {
        item,
        left: Math.min(92, Math.max(0, left)),
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

function getWorkItemCounts(workItems: WorkItemRecord[]) {
  return {
    all: workItems.length,
    todo: workItems.filter((item) => item.status === 'todo').length,
    inProgress: workItems.filter((item) => item.status === 'in-progress').length,
    review: 0,
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
      progress: averageProgress,
    },
    {
      label: '전체 업무',
      value: String(overview.summary.workItemCount),
      description: `완료 ${counts.done} · 진행중 ${counts.inProgress} · 대기 ${counts.todo}`,
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
      label: '임시',
      value: '역할 관련',
      description: '제작',
    },
  ]
}

function filterWorkItems(workItems: WorkItemRecord[], filter: WorkspaceStatusFilter) {
  if (filter === 'all') {
    return workItems
  }

  if (filter === 'review') {
    return []
  }

  return workItems.filter((item) => item.status === filter)
}

function getMemberName(userId: string, members: RoleMember[]) {
  return members.find((member) => member.userId === userId)?.name ?? userId
}

function getActivityDate(item: WorkItemRecord) {
  return formatWorkspaceMonthDay(item.createdAt)
}

export function WorkspacePage() {
  const currentUser = getCurrentUser()
  const [statusFilter, setStatusFilter] = useState<WorkspaceStatusFilter>('all')

  if (!currentUser) {
    return null
  }

  const overview = getWorkspaceOverview(currentUser.userId)
  const workspaceName = overview.rootNode?.name ?? '개인 워크스페이스'
  const counts = getWorkItemCounts(overview.visibleWorkItems)
  const metrics = getWorkspaceMetrics(overview)
  const filteredWorkItems = filterWorkItems(overview.visibleWorkItems, statusFilter).slice(0, BOARD_ITEM_LIMIT)
  const timeline = buildTimeline(overview.visibleWorkItems)
  const recentDocuments = overview.recentWorkItems.slice(0, DOCUMENT_LIMIT)
  const activityItems = [...overview.visibleWorkItems]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, 5)
  const visibleMembers =
    overview.rootRoleMembers.length > 0
      ? overview.rootRoleMembers.slice(0, 4)
      : [{ userId: currentUser.userId, name: currentUser.name, email: '', roleName: 'ADMIN' as const, assignmentId: 0 }]
  const extraMemberCount = Math.max(0, overview.rootRoleMembers.length - visibleMembers.length)
  const statusFilters: Array<{ id: WorkspaceStatusFilter; label: string; count: number; disabled?: boolean }> = [
    { id: 'all', label: '전체', count: counts.all },
    { id: 'todo', label: 'To do', count: counts.todo },
    { id: 'in-progress', label: '진행중', count: counts.inProgress },
    { id: 'review', label: '리뷰', count: counts.review, disabled: true },
    { id: 'done', label: '완료', count: counts.done },
  ]

  return (
    <section className={styles.page}>
      <header className={styles.workspaceHeader}>
        <div className={styles.headerCopy}>
          <p className={styles.breadcrumb}>
            <span>워크 스페이스</span>
            <Icon name="chevronRight" size={14} />
            <strong>{workspaceName}</strong>
          </p>
          <p className={styles.workspaceSubtitle}>공동작업을 위한 워크스페이스</p>
        </div>

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
      </header>

      <nav className={styles.workspaceTabs} aria-label="워크스페이스 보기">
        {workspaceTabs.map((tab) =>
          tab.to ? (
            <Link
              key={tab.label}
              to={tab.to}
              className={[styles.tabLink, tab.to === '/workspace' ? styles.tabLinkActive : ''].join(' ')}
            >
              {tab.label}
            </Link>
          ) : (
            <a key={tab.label} href={tab.href} className={styles.tabLink}>
              {tab.label}
            </a>
          ),
        )}
      </nav>

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
          <article key={metric.label} className={styles.metricCard}>
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
                      disabled={filter.disabled}
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
                + 새 업무
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
                filteredWorkItems.map((item) => (
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
                    <span>{formatWorkspaceMonthDay(item.dueDate)}</span>
                    <span className={getStatusBadgeClassName(item.status)}>{getWorkItemStatusLabel(item.status)}</span>
                  </Link>
                ))
              ) : (
                <p className={styles.emptyCopy}>선택한 상태에 표시할 업무가 없습니다.</p>
              )}
            </div>

            <Link to="/work-items" className={styles.panelFooterLink}>
              전체 업무 보기
              <Icon name="arrowRight" size={15} />
            </Link>
          </section>

          <section className={[styles.panel, styles.documentsPanel].join(' ')}>
            <div className={styles.panelHeader}>
              <h3 className={styles.panelTitle}>주요 문서</h3>
              <Link to="/documents" className={styles.textAction}>
                전체 보기
                <Icon name="arrowRight" size={14} />
              </Link>
            </div>

            <div className={styles.documentCards}>
              {recentDocuments.map((item) => (
                <Link key={item.workItemId} to={`/work-items/${item.workItemId}`} className={styles.documentCard}>
                  <span className={styles.documentIcon}>
                    <Icon name="fileText" size={16} />
                  </span>
                  <strong>{item.title}</strong>
                  <small>{formatWorkspaceMonthDay(item.createdAt)}</small>
                </Link>
              ))}
              <Link to="/documents" className={styles.addDocumentCard}>
                + 새 문서 추가
              </Link>
            </div>
          </section>
        </div>

        <div className={styles.rightColumn}>
          <section id="workspace-timeline" className={[styles.panel, styles.timelinePanel].join(' ')}>
            <div className={styles.panelHeader}>
              <h3 className={styles.panelTitle}>타임라인</h3>
              <Link to="/calendar" className={styles.textAction}>
                전체 보기
                <Icon name="arrowRight" size={14} />
              </Link>
            </div>

            <div className={styles.timelineMonthHeader} aria-hidden="true">
              {timeline.monthLabels.map((month) => (
                <strong key={month}>{month}</strong>
              ))}
            </div>
            <div className={styles.timelineScale} aria-hidden="true">
              {timeline.ticks.map((tick, index) => (
                <span key={`${tick}-${index}`}>{tick}</span>
              ))}
            </div>

            <div className={styles.timelineList}>
              <span
                className={styles.todayLine}
                style={{ left: `calc(${timeline.todayLeft}% + ${(1 - timeline.todayLeft / 100) * 5.8}rem)` }}
                aria-hidden="true"
              >
                오늘
              </span>
              {timeline.items.length > 0 ? (
                timeline.items.map(({ item, left, width }) => (
                  <Link key={item.workItemId} to={`/work-items/${item.workItemId}`} className={styles.timelineItem}>
                    <span>{item.title}</span>
                    <div className={styles.timelineTrack}>
                      <i style={{ left: `${left}%`, width: `${width}%` }} />
                    </div>
                  </Link>
                ))
              ) : (
                <p className={styles.emptyCopy}>일정이 등록된 업무가 없습니다.</p>
              )}
            </div>
          </section>

          <section className={[styles.panel, styles.activityPanel].join(' ')}>
            <div className={styles.panelHeader}>
              <h3 className={styles.panelTitle}>최근 활동</h3>
              <Link to="/dashboard" className={styles.textAction}>
                전체 보기
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
                    <p>
                      <strong>{getMemberName(item.ownerUserId, overview.rootRoleMembers)}</strong> 님이{' '}
                      <strong>{item.title}</strong> 업무를 {getWorkItemStatusLabel(item.status)} 상태로 업데이트했습니다.
                    </p>
                    <small>{getActivityDate(item)}</small>
                  </Link>
                ))
              ) : (
                <p className={styles.emptyCopy}>표시할 활동이 없습니다.</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </section>
  )
}
