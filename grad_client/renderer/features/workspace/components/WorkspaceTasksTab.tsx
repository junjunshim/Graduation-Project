import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../../design-system/primitives/Button'
import { Icon } from '../../../design-system/primitives/Icon'
import { UserAvatar } from '../../../design-system/primitives/UserAvatar'
import { formatWorkspaceShortDate, getWorkItemDisplayCode } from '../model/formatters'
import {
  getWorkItemStatusLabel,
  getWorkItemStatusTone,
  getCategoryBadgeStyle,
  getWorkItemPriorityMeta,
  type WorkItemPriorityTone,
} from '../model/labels'
import type { OrganizationNodeRecord, UserRecord, WorkItemRecord, WorkItemStatus } from '../model/types'
import { getWorkItemTag } from '../model/workItemTags'
import type { WorkItemTagId } from '../model/workItemTags'
import { getWorkItemDueScheduleInfo, parseWorkspaceDay } from '../model/workItemDue'
import type { DueScheduleType } from '../model/workItemDue'
import { getNodeVisualMetadata } from '../queries/workspaceDirectory'
import { getOrgSnapshot } from '../data/orgService'
import { restoreWorkItem } from '../data/workItemService'
import { getCascadeWorkItemSummary } from '../data/cascadeWorkItemHelper'
import { ConfirmRestoreModal } from './ConfirmRestoreModal'
import styles from './WorkspaceTasksTab.module.css'
import { useWorkItemContextMenu } from './useWorkItemContextMenu'

type WorkspaceTasksTabProps = {
  workItems: WorkItemRecord[]
  deletedWorkItems?: WorkItemRecord[]
  allWorkItems?: WorkItemRecord[]
  members: Array<Pick<UserRecord, 'userId' | 'name'> & Partial<Pick<UserRecord, 'email'>>>
  workspaces?: Array<Pick<OrganizationNodeRecord, 'id' | 'name' | 'nodeType' | 'path'>>
  tableLabel?: string
  createHref?: string
  filterLayout?: 'sidebar' | 'toolbar'
  showHeading?: boolean
  initialStatus?: string | null
  initialSchedule?: string | null
}

export type TaskViewMode = 'list' | 'tree'

type PriorityFilter = 'all' | WorkItemPriorityTone
type TagFilter = 'all' | WorkItemTagId
type StatusFilter = 'all' | WorkItemStatus
type DueScheduleFilter = 'all' | DueScheduleType

type TaskTreeNode = {
  item: WorkItemRecord
  children: TaskTreeNode[]
}

const WORK_ITEM_STATUSES: WorkItemStatus[] = ['done', 'in-progress', 'todo']
const PAGE_SIZE = 10
const MAX_PAGE_COUNT = 5
const MAX_VISIBLE_WORK_ITEMS = PAGE_SIZE * MAX_PAGE_COUNT
const INITIAL_STATUS_FILTERS: Record<WorkItemStatus, boolean> = {
  done: true,
  'in-progress': true,
  todo: true,
}

function getMemberName(
  userId: string,
  members: Array<Pick<UserRecord, 'userId' | 'name'> & Partial<Pick<UserRecord, 'email'>>>,
) {
  const found = members.find((member) => member.userId === userId || (member.email && member.email === userId))
  if (found) return found.name
  if (userId && !userId.startsWith('U-') && !userId.includes('@')) return userId
  return '미지정'
}

function getVisiblePageNumbers(currentPage: number, pageCount: number) {
  const visibleCount = Math.min(5, pageCount)
  const startPage = Math.max(1, Math.min(currentPage - 2, pageCount - visibleCount + 1))

  return Array.from({ length: visibleCount }, (_, index) => startPage + index)
}

function buildTaskTrees(items: WorkItemRecord[]): TaskTreeNode[] {
  const nodeMap = new Map<string, TaskTreeNode>()
  const rootNodes: TaskTreeNode[] = []

  items.forEach((item) => {
    nodeMap.set(item.workItemId, { item, children: [] })
  })

  items.forEach((item) => {
    const currentTreeNode = nodeMap.get(item.workItemId)
    if (!currentTreeNode) return

    if (item.parentWorkItemId && nodeMap.has(item.parentWorkItemId)) {
      const parentTreeNode = nodeMap.get(item.parentWorkItemId)
      parentTreeNode?.children.push(currentTreeNode)
    } else {
      rootNodes.push(currentTreeNode)
    }
  })

  return rootNodes
}

function TaskTreeNodeCard({
  node,
  depth = 0,
  members,
  collapsedMap,
  onToggleCollapse,
  isTrashMode = false,
  onRestore,
}: {
  node: TaskTreeNode
  depth?: number
  members: Array<Pick<UserRecord, 'userId' | 'name'>>
  collapsedMap: ReadonlyMap<string, boolean>
  onToggleCollapse: (id: string) => void
  isTrashMode?: boolean
  onRestore?: (item: WorkItemRecord) => void
}) {
  const { item, children } = node
  const hasChildren = children.length > 0
  const isCollapsed = collapsedMap.get(item.workItemId) ?? false
  const statusTone = getWorkItemStatusTone(item.status)
  const priorityMeta = getWorkItemPriorityMeta(item.priority)
  const tag = getWorkItemTag(item)
  const ownerName = getMemberName(item.ownerUserId, members)
  const dueDate = item.dueDate ? formatWorkspaceShortDate(item.dueDate) : null
  const dueScheduleInfo = getWorkItemDueScheduleInfo(item)

  return (
    <div className={styles.treeNodeContainer}>
      <div
        className={[styles.treeRow, isTrashMode ? styles.trashRowDeleted : ''].join(' ')}
        data-work-item-id={item.workItemId}
      >
        <div className={styles.treeRowMain}>
          <div className={styles.treeRowLeft}>
            {hasChildren ? (
              <button
                type="button"
                className={styles.treeExpandButton}
                onClick={() => onToggleCollapse(item.workItemId)}
                aria-label={isCollapsed ? '하위 업무 펼치기' : '하위 업무 접기'}
              >
                <Icon name={isCollapsed ? 'chevronRight' : 'chevronDown'} size={13} />
              </button>
            ) : (
              <span className={styles.treeLeafDot} />
            )}

            <div className={styles.treeTitleGroup}>
              <div className={styles.treeTitle}>
                {isTrashMode ? (
                  <span className={styles.trashDeletedBadge}>삭제됨</span>
                ) : null}
                <span className={styles.taskCodeBadge}>{getWorkItemDisplayCode(item)}</span>
                {isTrashMode ? (
                  <span className={styles.taskTitleText} style={{ textDecoration: 'line-through' }}>
                    {item.title}
                  </span>
                ) : (
                  <Link to={`/work-items/${item.workItemId}`} className={styles.taskTitleText}>
                    {item.title}
                  </Link>
                )}
              </div>
              {item.description ? (
                <p className={styles.treeDescription}>{item.description}</p>
              ) : null}
            </div>
          </div>

          <div className={styles.treeMetaGroup}>
            {tag ? (
              <span className={styles.tagBadge} data-tone={tag.tone} style={tag.style}>
                {tag.label}
              </span>
            ) : null}

            <span className={styles.statusBadge} data-tone={statusTone}>
              {getWorkItemStatusLabel(item.status)}
            </span>

            <span className={styles.priority} data-priority={priorityMeta.tone}>
              <strong>{priorityMeta.symbol}</strong>
              {priorityMeta.label}
            </span>

            {dueDate ? (
              <span className={styles.treeDueDate}>
                {item.status !== 'done' &&
                (dueScheduleInfo.scheduleType === 'dueSoon' || dueScheduleInfo.scheduleType === 'overdue') ? (
                  <span
                    className={styles.dueUrgentMark}
                    data-tone={dueScheduleInfo.tone}
                    title={dueScheduleInfo.label}
                  >
                    !
                  </span>
                ) : null}
                <Icon name="calendar" size={13} />
                {dueDate}
              </span>
            ) : null}

            <div className={styles.treeOwner}>
              <UserAvatar name={ownerName} userId={item.ownerUserId} size="small" />
              <span>{ownerName}</span>
            </div>

            {hasChildren ? (
              <span className={styles.treeChildBadge}>
                하위 {children.length}
              </span>
            ) : null}

            {isTrashMode && onRestore ? (
              <button
                type="button"
                className={styles.trashRestoreButton}
                onClick={() => onRestore(item)}
                title="업무 복구하기"
              >
                <Icon name="restore" size={12} />
                <span>복구</span>
              </button>
            ) : null}
          </div>
        </div>

        {typeof item.progress === 'number' && item.progress > 0 ? (
          <div className={styles.treeProgressTrack}>
            <div
              className={styles.treeProgressBar}
              data-status={item.status}
              style={{ width: `${Math.min(100, Math.max(0, item.progress))}%` }}
            />
          </div>
        ) : null}
      </div>

      {hasChildren && !isCollapsed ? (
        <div className={styles.treeChildrenGroup}>
          {children.map((child) => (
            <TaskTreeNodeCard
              key={child.item.workItemId}
              node={child}
              depth={depth + 1}
              members={members}
              collapsedMap={collapsedMap}
              onToggleCollapse={onToggleCollapse}
              isTrashMode={isTrashMode}
              onRestore={onRestore}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function TaskTreeView({
  trees,
  members,
  totalCount,
  isTrashMode = false,
  onRestore,
}: {
  trees: TaskTreeNode[]
  members: Array<Pick<UserRecord, 'userId' | 'name'>>
  totalCount: number
  isTrashMode?: boolean
  onRestore?: (item: WorkItemRecord) => void
}) {
  const [collapsedMap, setCollapsedMap] = useState<Map<string, boolean>>(() => new Map())

  function toggleCollapse(id: string) {
    setCollapsedMap((prev) => {
      const next = new Map(prev)
      next.set(id, !next.get(id))
      return next
    })
  }

  function expandAll() {
    setCollapsedMap(new Map())
  }

  function collapseAll() {
    const next = new Map<string, boolean>()
    const markAll = (nodes: TaskTreeNode[]) => {
      nodes.forEach((node) => {
        if (node.children.length > 0) {
          next.set(node.item.workItemId, true)
          markAll(node.children)
        }
      })
    }
    markAll(trees)
    setCollapsedMap(next)
  }

  if (trees.length === 0) {
    return (
      <div className={styles.treeEmptyState}>
        <Icon name="folder" size={32} />
        <p>조건에 일치하는 업무가 없습니다.</p>
      </div>
    )
  }

  return (
    <div className={styles.treeViewWrapper}>
      <div className={styles.treeViewToolbar}>
        <div className={styles.treeViewSummary}>
          <strong>총 {totalCount}개 업무</strong> (루트 업무 {trees.length}개)
        </div>
        <div className={styles.treeViewActions}>
          <button type="button" className={styles.treeToolbarButton} onClick={expandAll}>
            모두 펼치기
          </button>
          <button type="button" className={styles.treeToolbarButton} onClick={collapseAll}>
            모두 접기
          </button>
        </div>
      </div>

      <div className={styles.treeViewContent}>
        {trees.map((rootNode) => (
          <TaskTreeNodeCard
            key={rootNode.item.workItemId}
            node={rootNode}
            members={members}
            collapsedMap={collapsedMap}
            onToggleCollapse={toggleCollapse}
            isTrashMode={isTrashMode}
            onRestore={onRestore}
          />
        ))}
      </div>
    </div>
  )
}

export function WorkspaceTasksTab({
  workItems,
  deletedWorkItems = [],
  allWorkItems = [],
  members,
  workspaces = [],
  tableLabel = '워크스페이스 업무 목록',
  createHref = '/work-items?view=create',
  filterLayout = 'sidebar',
  showHeading = true,
  initialStatus,
  initialSchedule,
}: WorkspaceTasksTabProps) {
  const { onWorkItemContextMenu, workItemContextMenu } = useWorkItemContextMenu()
  const [viewMode, setViewMode] = useState<TaskViewMode>('list')
  const [showDeletedTasks, setShowDeletedTasks] = useState(false)
  const [restoreConfirmTarget, setRestoreConfirmTarget] = useState<{
    item: WorkItemRecord
    attachedFiles: Array<{ id: number; name: string; size?: number; workItemTitle?: string }>
    childWorkItems: Array<{ id: string; title: string }>
    childCount: number
  } | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [workspaceFilter, setWorkspaceFilter] = useState('all')
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all')
  const [tagFilter, setTagFilter] = useState<TagFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    if (initialStatus && WORK_ITEM_STATUSES.includes(initialStatus as WorkItemStatus)) {
      return initialStatus as WorkItemStatus
    }
    return 'all'
  })
  const [scheduleFilter, setScheduleFilter] = useState<DueScheduleFilter>(() => {
    if (
      initialSchedule === 'dueSoon' ||
      initialSchedule === 'plenty' ||
      initialSchedule === 'overdue' ||
      initialSchedule === 'none'
    ) {
      return initialSchedule
    }
    return 'all'
  })
  const [statusFilters, setStatusFilters] = useState(() => {
    if (initialStatus && WORK_ITEM_STATUSES.includes(initialStatus as WorkItemStatus)) {
      return {
        done: initialStatus === 'done',
        'in-progress': initialStatus === 'in-progress',
        todo: initialStatus === 'todo',
      }
    }
    return INITIAL_STATUS_FILTERS
  })
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [isFilterOpen, setIsFilterOpen] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [openDropdown, setOpenDropdown] = useState<'workspace' | 'tag' | 'status' | 'schedule' | null>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (toolbarRef.current && !toolbarRef.current.contains(event.target as Node)) {
        setOpenDropdown(null)
      }
    }

    if (openDropdown !== null) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [openDropdown])

  const ownerOptions = useMemo(() => {
    const visibleOwnerIds = new Set(workItems.map((item) => item.ownerUserId))

    return Array.from(
      new Map(
        members
          .filter((member) => visibleOwnerIds.has(member.userId))
          .map((member) => [member.userId, member]),
      ).values(),
    )
  }, [members, workItems])

  const tagOptions = useMemo(() => {
    const map = new Map<string, { id: string; label: string }>()

    workItems.forEach((item) => {
      const tag = getWorkItemTag(item)
      if (tag) {
        map.set(tag.id, { id: tag.id, label: tag.label })
      }
    })

    return Array.from(map.values())
  }, [workItems])

  const workspaceOptions = useMemo(
    () => workspaces.filter((workspace) => workspace.nodeType !== 'USER'),
    [workspaces],
  )

  const selectedWorkspaceObj = useMemo(
    () => workspaceOptions.find((w) => String(w.id) === workspaceFilter),
    [workspaceOptions, workspaceFilter],
  )

  const selectedTagObj = useMemo(
    () => tagOptions.find((t) => t.id === tagFilter),
    [tagOptions, tagFilter],
  )

  const selectedScheduleBadge = useMemo(() => {
    switch (scheduleFilter) {
      case 'dueSoon':
        return { label: '마감 임박', tone: 'soon' as const }
      case 'plenty':
        return { label: '여유 있음', tone: 'neutral' as const }
      case 'overdue':
        return { label: '기한 지남', tone: 'overdue' as const }
      case 'none':
        return { label: '마감 미정', tone: 'neutral' as const }
      default:
        return null
    }
  }, [scheduleFilter])

  const effectiveWorkItems = useMemo(() => {
    if (showDeletedTasks) {
      return deletedWorkItems
    }
    return workItems
  }, [showDeletedTasks, deletedWorkItems, workItems])

  const prevDeletedTasksCountRef = useRef(deletedWorkItems.length)

  // 옵션 C: 휴지통 모드 중 복구 등으로 삭제된 업무가 0개가 되면 자동으로 기본 업무 화면으로 전환
  // (0개 상태에서 클릭하여 진입 시 튕겨져 나가는 깜박임 현상 방지: 이전 카운트가 1 이상이었다가 0이 된 경우에만 자동 전환)
  useEffect(() => {
    if (showDeletedTasks && prevDeletedTasksCountRef.current > 0 && deletedWorkItems.length === 0) {
      setShowDeletedTasks(false)
    }
    prevDeletedTasksCountRef.current = deletedWorkItems.length
  }, [showDeletedTasks, deletedWorkItems.length])

  const filteredWorkItems = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase('ko-KR')

    return effectiveWorkItems.filter((item) => {
      const selectedWorkspace = workspaceOptions.find(
        (workspace) => String(workspace.id) === workspaceFilter,
      )
      const matchesWorkspace =
        workspaceFilter === 'all' ||
        (selectedWorkspace !== undefined && item.ownerNodeId === selectedWorkspace.id)
      const ownerName = getMemberName(item.ownerUserId, members)
      const matchesQuery =
        normalizedQuery.length === 0 ||
        item.title.toLocaleLowerCase('ko-KR').includes(normalizedQuery) ||
        (filterLayout === 'sidebar' && ownerName.toLocaleLowerCase('ko-KR').includes(normalizedQuery))
      const matchesOwner = ownerFilter === 'all' || item.ownerUserId === ownerFilter

      // 휴지통 모드일 때는 일반 상태/일정 필터를 무시하고 오직 삭제된 업무 전체를 대상 처리
      if (showDeletedTasks) {
        return matchesWorkspace && matchesQuery && matchesOwner
      }

      const matchesStatus =
        filterLayout === 'toolbar'
          ? statusFilter === 'all'
            ? true
            : item.status === statusFilter
          : statusFilters[item.status]
      const dueScheduleInfo = getWorkItemDueScheduleInfo(item)
      const matchesSchedule =
        scheduleFilter === 'all'
          ? true
          : scheduleFilter === 'none'
            ? parseWorkspaceDay(item.dueDate) === null
            : dueScheduleInfo.scheduleType === scheduleFilter
      const matchesPriority =
        priorityFilter === 'all' || getWorkItemPriorityMeta(item.priority).tone === priorityFilter
      const matchesTag = tagFilter === 'all' || getWorkItemTag(item)?.id === tagFilter
      const itemStart = item.startDate ?? item.dueDate
      const itemEnd = item.dueDate ?? item.startDate
      const hasActiveDateRange = Boolean(rangeStart || rangeEnd)
      const matchesDateRange =
        !hasActiveDateRange ||
        (itemStart !== undefined &&
          itemEnd !== undefined &&
          (!rangeStart || itemEnd >= rangeStart) &&
          (!rangeEnd || itemStart <= rangeEnd))

      return (
        matchesWorkspace &&
        matchesQuery &&
        matchesOwner &&
        matchesStatus &&
        matchesSchedule &&
        matchesPriority &&
        matchesTag &&
        matchesDateRange
      )
    })
  }, [
    filterLayout,
    members,
    ownerFilter,
    priorityFilter,
    rangeEnd,
    rangeStart,
    scheduleFilter,
    searchQuery,
    statusFilter,
    statusFilters,
    tagFilter,
    workspaceFilter,
    workspaceOptions,
    workspaces,
    effectiveWorkItems,
    showDeletedTasks,
  ])

  const visibleWorkItems = filteredWorkItems.slice(0, MAX_VISIBLE_WORK_ITEMS)
  const pageCount = Math.max(1, Math.ceil(visibleWorkItems.length / PAGE_SIZE))
  const activePage = Math.min(currentPage, pageCount)
  const pageStartIndex = (activePage - 1) * PAGE_SIZE
  const pagedWorkItems = visibleWorkItems.slice(pageStartIndex, pageStartIndex + PAGE_SIZE)
  const visiblePageNumbers = getVisiblePageNumbers(activePage, pageCount)
  const allVisibleSelected =
    pagedWorkItems.length > 0 && pagedWorkItems.every((item) => selectedIds.has(item.workItemId))

  function toggleAllVisible() {
    setSelectedIds((current) => {
      const next = new Set(current)

      pagedWorkItems.forEach((item) => {
        if (allVisibleSelected) {
          next.delete(item.workItemId)
        } else {
          next.add(item.workItemId)
        }
      })

      return next
    })
  }

  function toggleSelected(workItemId: string) {
    setSelectedIds((current) => {
      const next = new Set(current)

      if (next.has(workItemId)) {
        next.delete(workItemId)
      } else {
        next.add(workItemId)
      }

      return next
    })
  }

  function resetFilters() {
    setSearchQuery('')
    setWorkspaceFilter('all')
    setOwnerFilter('all')
    setPriorityFilter('all')
    setTagFilter('all')
    setStatusFilter('all')
    setScheduleFilter('all')
    setStatusFilters(INITIAL_STATUS_FILTERS)
    setRangeStart('')
    setRangeEnd('')
    setCurrentPage(1)
  }

  const taskTrees = useMemo(() => buildTaskTrees(filteredWorkItems), [filteredWorkItems])

  function handleRestoreClick(item: WorkItemRecord) {
    const snapshot = getOrgSnapshot()
    const summary = getCascadeWorkItemSummary(
      item.workItemId,
      allWorkItems.length > 0 ? allWorkItems : snapshot.workItems,
      snapshot.files ?? [],
      true,
    )
    const attachedFiles = summary ? summary.allFiles : []
    const childWorkItems = summary
      ? summary.descendantWorkItems.map((c) => ({ id: c.workItemId, title: c.title }))
      : []

    setRestoreConfirmTarget({
      item,
      attachedFiles,
      childWorkItems,
      childCount: childWorkItems.length,
    })
  }

  return (
    <section
      className={styles.panel}
      onContextMenu={showDeletedTasks ? undefined : onWorkItemContextMenu}
      aria-labelledby={showHeading ? 'workspace-tasks-title' : undefined}
      aria-label={showHeading ? undefined : tableLabel}
    >
      {!showDeletedTasks && workItemContextMenu}
      {showHeading ? (
        <header className={styles.pageHeader}>
          <div className={styles.pageHeaderTitleGroup}>
            <h2 id="workspace-tasks-title">
              {showDeletedTasks
                ? '휴지통 (삭제된 업무)'
                : viewMode === 'list'
                  ? '업무 목록'
                  : '업무 트리'}
            </h2>
            <p>
              {showDeletedTasks
                ? '삭제된 업무와 하위 과제를 확인하고 원래 상태로 복구합니다.'
                : viewMode === 'list'
                  ? '워크스페이스에 등록된 모든 업무를 표 형태로 조회하고 관리합니다.'
                  : '루트 업무부터 하위 세부 과제까지 계층 구조로 한눈에 파악합니다.'}
            </p>
          </div>

          <div className={styles.headerActions}>
            <div className={styles.viewSegmentGroup} role="group" aria-label="업무 보기 방식">
              <Button
                type="button"
                variant={!showDeletedTasks && viewMode === 'list' ? 'primary' : 'secondary'}
                className={[styles.viewSegmentButton, !showDeletedTasks && viewMode === 'list' ? styles.viewSegmentActive : ''].join(' ')}
                aria-pressed={!showDeletedTasks && viewMode === 'list'}
                onClick={() => {
                  setShowDeletedTasks(false)
                  setViewMode('list')
                }}
              >
                <Icon name="list" size={15} />
                업무 목록
              </Button>
              <Button
                type="button"
                variant={!showDeletedTasks && viewMode === 'tree' ? 'primary' : 'secondary'}
                className={[styles.viewSegmentButton, !showDeletedTasks && viewMode === 'tree' ? styles.viewSegmentActive : ''].join(' ')}
                aria-pressed={!showDeletedTasks && viewMode === 'tree'}
                onClick={() => {
                  setShowDeletedTasks(false)
                  setViewMode('tree')
                }}
              >
                <Icon name="orgChart" size={15} />
                업무 트리
              </Button>
            </div>

            <button
              type="button"
              className={[styles.trashToggleBtn, showDeletedTasks ? styles.trashToggleBtnActive : ''].join(' ')}
              disabled={deletedWorkItems.length === 0}
              onClick={() => {
                if (deletedWorkItems.length === 0) return
                setShowDeletedTasks((prev) => {
                  const next = !prev
                  if (next) {
                    setViewMode('tree') // 휴지통 모드 진입 시 계층형 트리 형태로 직관적 확인
                  }
                  return next
                })
              }}
              title={
                deletedWorkItems.length === 0
                  ? '휴지통이 비어 있습니다'
                  : showDeletedTasks
                    ? '삭제된 업무 숨기기'
                    : '휴지통 업무 보기'
              }
            >
              <Icon name="trash" size={14} />
              <span>휴지통{deletedWorkItems.length > 0 ? ` (${deletedWorkItems.length})` : ''}</span>
            </button>

            {!showDeletedTasks && filterLayout === 'sidebar' && !isFilterOpen ? (
              <button type="button" className={styles.secondaryButton} onClick={() => setIsFilterOpen(true)}>
                필터 열기
              </button>
            ) : null}
          </div>
        </header>
      ) : null}

      {filterLayout === 'toolbar' ? (
        <div ref={toolbarRef} className={styles.listToolbar} aria-label="업무 목록 필터">
          {/* 워크스페이스 드롭다운 */}
          <div className={styles.toolbarFilterItem}>
            <button
              type="button"
              className={[styles.toolbarDropdownTrigger, openDropdown === 'workspace' ? styles.dropdownOpen : ''].join(' ')}
              onClick={() => setOpenDropdown((prev) => (prev === 'workspace' ? null : 'workspace'))}
              aria-expanded={openDropdown === 'workspace'}
              aria-haspopup="listbox"
            >
              <div className={styles.toolbarFieldDisplay}>
                {selectedWorkspaceObj ? (
                  <>
                    <Icon name={getNodeVisualMetadata(selectedWorkspaceObj.nodeType).iconName} size={14} className={styles.toolbarWorkspaceIcon} />
                    <span className={styles.toolbarFieldText}>{selectedWorkspaceObj.name}</span>
                  </>
                ) : (
                  <>
                    <Icon name="folder" size={14} className={styles.toolbarWorkspaceIcon} />
                    <span className={styles.toolbarFieldPlaceholder}>전체 워크스페이스</span>
                  </>
                )}
              </div>
              <Icon name="chevronDown" size={14} className={openDropdown === 'workspace' ? styles.rotateIcon : undefined} />
            </button>

            {openDropdown === 'workspace' && (
              <div className={styles.filterDropdownMenu} role="listbox">
                <button
                  type="button"
                  role="option"
                  aria-selected={workspaceFilter === 'all'}
                  className={[styles.dropdownItem, workspaceFilter === 'all' ? styles.dropdownItemSelected : ''].join(' ')}
                  onClick={() => {
                    setWorkspaceFilter('all')
                    setCurrentPage(1)
                    setOpenDropdown(null)
                  }}
                >
                  <Icon name="folder" size={14} className={styles.toolbarWorkspaceIcon} />
                  <span className={styles.dropdownItemText}>전체 워크스페이스</span>
                </button>
                {workspaceOptions.map((workspace) => (
                  <button
                    key={workspace.id}
                    type="button"
                    role="option"
                    aria-selected={String(workspace.id) === workspaceFilter}
                    className={[styles.dropdownItem, String(workspace.id) === workspaceFilter ? styles.dropdownItemSelected : ''].join(' ')}
                    onClick={() => {
                      setWorkspaceFilter(String(workspace.id))
                      setCurrentPage(1)
                      setOpenDropdown(null)
                    }}
                  >
                    <Icon name={getNodeVisualMetadata(workspace.nodeType).iconName} size={14} className={styles.toolbarWorkspaceIcon} />
                    <span className={styles.dropdownItemText}>{workspace.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 카테고리 드롭다운 */}
          <div className={styles.toolbarFilterItem}>
            <button
              type="button"
              className={[styles.toolbarDropdownTrigger, openDropdown === 'tag' ? styles.dropdownOpen : ''].join(' ')}
              onClick={() => setOpenDropdown((prev) => (prev === 'tag' ? null : 'tag'))}
              aria-expanded={openDropdown === 'tag'}
              aria-haspopup="listbox"
            >
              <div className={styles.toolbarFieldDisplay}>
                {selectedTagObj ? (
                  <span
                    className={styles.toolbarBadge}
                    style={getCategoryBadgeStyle(selectedTagObj.label)}
                  >
                    {selectedTagObj.label}
                  </span>
                ) : (
                  <span className={styles.toolbarFieldPlaceholder}>전체 카테고리</span>
                )}
              </div>
              <Icon name="chevronDown" size={14} className={openDropdown === 'tag' ? styles.rotateIcon : undefined} />
            </button>

            {openDropdown === 'tag' && (
              <div className={styles.filterDropdownMenu} role="listbox">
                <button
                  type="button"
                  role="option"
                  aria-selected={tagFilter === 'all'}
                  className={[styles.dropdownItem, tagFilter === 'all' ? styles.dropdownItemSelected : ''].join(' ')}
                  onClick={() => {
                    setTagFilter('all')
                    setCurrentPage(1)
                    setOpenDropdown(null)
                  }}
                >
                  <span className={styles.dropdownItemText}>전체 카테고리</span>
                </button>
                {tagOptions.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    role="option"
                    aria-selected={tag.id === tagFilter}
                    className={[styles.dropdownItem, tag.id === tagFilter ? styles.dropdownItemSelected : ''].join(' ')}
                    onClick={() => {
                      setTagFilter(tag.id as TagFilter)
                      setCurrentPage(1)
                      setOpenDropdown(null)
                    }}
                  >
                    <span className={styles.toolbarBadge} style={getCategoryBadgeStyle(tag.label)}>
                      {tag.label}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 상태 드롭다운 */}
          <div className={styles.toolbarFilterItem}>
            <button
              type="button"
              className={[styles.toolbarDropdownTrigger, openDropdown === 'status' ? styles.dropdownOpen : ''].join(' ')}
              onClick={() => setOpenDropdown((prev) => (prev === 'status' ? null : 'status'))}
              aria-expanded={openDropdown === 'status'}
              aria-haspopup="listbox"
            >
              <div className={styles.toolbarFieldDisplay}>
                {statusFilter !== 'all' ? (
                  <span
                    className={styles.statusBadge}
                    data-tone={getWorkItemStatusTone(statusFilter)}
                  >
                    {getWorkItemStatusLabel(statusFilter)}
                  </span>
                ) : (
                  <span className={styles.toolbarFieldPlaceholder}>전체 상태</span>
                )}
              </div>
              <Icon name="chevronDown" size={14} className={openDropdown === 'status' ? styles.rotateIcon : undefined} />
            </button>

            {openDropdown === 'status' && (
              <div className={styles.filterDropdownMenu} role="listbox">
                <button
                  type="button"
                  role="option"
                  aria-selected={statusFilter === 'all'}
                  className={[styles.dropdownItem, statusFilter === 'all' ? styles.dropdownItemSelected : ''].join(' ')}
                  onClick={() => {
                    setStatusFilter('all')
                    setCurrentPage(1)
                    setOpenDropdown(null)
                  }}
                >
                  <span className={styles.dropdownItemText}>전체 상태</span>
                </button>
                {WORK_ITEM_STATUSES.map((status) => (
                  <button
                    key={status}
                    type="button"
                    role="option"
                    aria-selected={status === statusFilter}
                    className={[styles.dropdownItem, status === statusFilter ? styles.dropdownItemSelected : ''].join(' ')}
                    onClick={() => {
                      setStatusFilter(status)
                      setCurrentPage(1)
                      setOpenDropdown(null)
                    }}
                  >
                    <span className={styles.statusBadge} data-tone={getWorkItemStatusTone(status)}>
                      {getWorkItemStatusLabel(status)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 일정 드롭다운 */}
          <div className={styles.toolbarFilterItem}>
            <button
              type="button"
              className={[styles.toolbarDropdownTrigger, openDropdown === 'schedule' ? styles.dropdownOpen : ''].join(' ')}
              onClick={() => setOpenDropdown((prev) => (prev === 'schedule' ? null : 'schedule'))}
              aria-expanded={openDropdown === 'schedule'}
              aria-haspopup="listbox"
            >
              <div className={styles.toolbarFieldDisplay}>
                {selectedScheduleBadge ? (
                  <span className={styles.dueBadge} data-tone={selectedScheduleBadge.tone}>
                    {selectedScheduleBadge.label}
                  </span>
                ) : (
                  <span className={styles.toolbarFieldPlaceholder}>전체 일정</span>
                )}
              </div>
              <Icon name="chevronDown" size={14} className={openDropdown === 'schedule' ? styles.rotateIcon : undefined} />
            </button>

            {openDropdown === 'schedule' && (
              <div className={styles.filterDropdownMenu} role="listbox">
                <button
                  type="button"
                  role="option"
                  aria-selected={scheduleFilter === 'all'}
                  className={[styles.dropdownItem, scheduleFilter === 'all' ? styles.dropdownItemSelected : ''].join(' ')}
                  onClick={() => {
                    setScheduleFilter('all')
                    setCurrentPage(1)
                    setOpenDropdown(null)
                  }}
                >
                  <span className={styles.dropdownItemText}>전체 일정</span>
                </button>
                <button
                  type="button"
                  role="option"
                  aria-selected={scheduleFilter === 'dueSoon'}
                  className={[styles.dropdownItem, scheduleFilter === 'dueSoon' ? styles.dropdownItemSelected : ''].join(' ')}
                  onClick={() => {
                    setScheduleFilter('dueSoon')
                    setCurrentPage(1)
                    setOpenDropdown(null)
                  }}
                >
                  <span className={styles.dueBadge} data-tone="soon">
                    마감 임박 (7일 이내)
                  </span>
                </button>
                <button
                  type="button"
                  role="option"
                  aria-selected={scheduleFilter === 'plenty'}
                  className={[styles.dropdownItem, scheduleFilter === 'plenty' ? styles.dropdownItemSelected : ''].join(' ')}
                  onClick={() => {
                    setScheduleFilter('plenty')
                    setCurrentPage(1)
                    setOpenDropdown(null)
                  }}
                >
                  <span className={styles.dueBadge} data-tone="neutral">
                    여유 있음
                  </span>
                </button>
                <button
                  type="button"
                  role="option"
                  aria-selected={scheduleFilter === 'overdue'}
                  className={[styles.dropdownItem, scheduleFilter === 'overdue' ? styles.dropdownItemSelected : ''].join(' ')}
                  onClick={() => {
                    setScheduleFilter('overdue')
                    setCurrentPage(1)
                    setOpenDropdown(null)
                  }}
                >
                  <span className={styles.dueBadge} data-tone="overdue">
                    기한 지남
                  </span>
                </button>
                <button
                  type="button"
                  role="option"
                  aria-selected={scheduleFilter === 'none'}
                  className={[styles.dropdownItem, scheduleFilter === 'none' ? styles.dropdownItemSelected : ''].join(' ')}
                  onClick={() => {
                    setScheduleFilter('none')
                    setCurrentPage(1)
                    setOpenDropdown(null)
                  }}
                >
                  <span className={styles.dueBadge} data-tone="neutral">
                    마감일 미정
                  </span>
                </button>
              </div>
            )}
          </div>

          <div className={[styles.toolbarField, styles.dateRangeField].join(' ')}>
            <Icon name="calendar" size={15} />
            <label>
              <span className={styles.visuallyHidden}>검색 시작일</span>
              <input
                type="date"
                value={rangeStart}
                max={rangeEnd || undefined}
                onChange={(event) => {
                  setRangeStart(event.target.value)
                  setCurrentPage(1)
                }}
              />
            </label>
            <span aria-hidden="true">~</span>
            <label>
              <span className={styles.visuallyHidden}>검색 종료일</span>
              <input
                type="date"
                value={rangeEnd}
                min={rangeStart || undefined}
                onChange={(event) => {
                  setRangeEnd(event.target.value)
                  setCurrentPage(1)
                }}
              />
            </label>
          </div>

          <label className={[styles.toolbarField, styles.toolbarSearch].join(' ')}>
            <span className={styles.visuallyHidden}>업무 제목 검색</span>
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value)
                setCurrentPage(1)
              }}
              placeholder="업무 제목 검색"
            />
            <Icon name="search" size={16} />
          </label>
        </div>
      ) : null}

      {showDeletedTasks ? (
        <div className={styles.trashNoticeBanner} role="status">
          <div className={styles.trashNoticeLeft}>
            <Icon name="alertTriangle" size={16} />
            <span>휴지통 모드: 삭제된 업무는 15일간 보관 후 영구 삭제됩니다.</span>
            <span className={styles.trashNoticeCount}>총 {deletedWorkItems.length}개 삭제됨</span>
          </div>
          <button
            type="button"
            className={styles.secondaryButton}
            style={{ fontSize: '0.75rem', padding: '3px 10px', height: 'auto' }}
            onClick={() => setShowDeletedTasks(false)}
          >
            기본 업무 목록으로 돌아가기
          </button>
        </div>
      ) : null}

      <div
        className={[
          styles.contentGrid,
          showDeletedTasks || filterLayout === 'toolbar' || !isFilterOpen ? styles.contentGridFull : '',
        ].filter(Boolean).join(' ')}
      >
        {viewMode === 'tree' ? (
          <TaskTreeView
            trees={taskTrees}
            members={members}
            totalCount={filteredWorkItems.length}
            isTrashMode={showDeletedTasks}
            onRestore={handleRestoreClick}
          />
        ) : (
          <div className={styles.tableCard}>
            <div className={styles.tableScroller} role="table" aria-label={tableLabel}>
              <div className={styles.tableHeader} role="row">
                <div className={styles.tableHeaderLeft}>
                  <span role="columnheader" className={styles.checkboxCell}>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={toggleAllVisible}
                      aria-label="현재 페이지 업무 전체 선택"
                    />
                  </span>
                  <span role="columnheader" className={styles.titleHeader}>업무명 / 담당자</span>
                </div>
                <div className={styles.tableHeaderRight}>
                  <span>상태 · 우선순위 / 마감일</span>
                </div>
              </div>

              <div
                className={[styles.tableBody, pagedWorkItems.length === 0 ? styles.tableBodyEmpty : ''].filter(Boolean).join(' ')}
                role="rowgroup"
              >
                {pagedWorkItems.length > 0 ? (
                  pagedWorkItems.map((item) => {
                    const isSelected = selectedIds.has(item.workItemId)
                    const ownerName = getMemberName(item.ownerUserId, members)
                    const statusTone = getWorkItemStatusTone(item.status)
                    const priorityMeta = getWorkItemPriorityMeta(item.priority)
                    const tag = getWorkItemTag(item)
                    const dueScheduleInfo = getWorkItemDueScheduleInfo(item)

                    return (
                      <div
                        key={item.workItemId}
                        data-work-item-id={item.workItemId}
                        className={[styles.taskRow, isSelected ? styles.taskRowSelected : '', showDeletedTasks ? styles.trashRowDeleted : ''].filter(Boolean).join(' ')}
                        role="row"
                      >
                        <span role="cell" className={styles.checkboxCell}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelected(item.workItemId)}
                            aria-label={`${item.title} 선택`}
                          />
                        </span>

                        <div className={styles.rowMainContent}>
                          {/* 좌측 영역: 1층 [업무코드][카테고리][업무명] / 2층 [담당자] + [댓글 수] */}
                          <div className={styles.rowLeftBlock}>
                            <div className={styles.rowTopLine}>
                              {showDeletedTasks ? (
                                <div className={styles.taskTitle} style={{ cursor: 'default' }}>
                                  <span className={styles.trashDeletedBadge}>삭제됨</span>
                                  <span className={styles.taskCodeBadge}>{getWorkItemDisplayCode(item)}</span>
                                  {tag ? (
                                    <span className={styles.tagBadge} data-tone={tag.tone} style={tag.style}>
                                      {tag.label}
                                    </span>
                                  ) : null}
                                  <span className={styles.taskTitleText} style={{ textDecoration: 'line-through', opacity: 0.75 }}>
                                    {item.title}
                                  </span>
                                </div>
                              ) : (
                                <Link to={`/work-items/${item.workItemId}`} className={styles.taskTitle}>
                                  <span className={styles.taskCodeBadge}>{getWorkItemDisplayCode(item)}</span>
                                  {tag ? (
                                    <span className={styles.tagBadge} data-tone={tag.tone} style={tag.style}>
                                      {tag.label}
                                    </span>
                                  ) : null}
                                  <span className={styles.taskTitleText}>{item.title}</span>
                                </Link>
                              )}
                            </div>

                            <div className={styles.rowBottomLine}>
                              <span className={styles.metaOwner}>
                                <UserAvatar name={ownerName} userId={item.ownerUserId} size="small" />
                                <span className={styles.ownerName}>{ownerName}</span>
                              </span>

                              <span
                                className={[
                                  styles.commentPill,
                                  !item.commentCount ? styles.commentPillEmpty : '',
                                ].filter(Boolean).join(' ')}
                                title={item.commentCount ? `댓글 ${item.commentCount}개` : '댓글 없음'}
                              >
                                <Icon name="messageCircle" size={12} />
                                <span>{item.commentCount ?? 0}</span>
                              </span>
                            </div>
                          </div>

                          {/* 우측 영역: 1층 [상태 뱃지][우선순위 뱃지] / 2층 [마감일] */}
                          <div className={styles.rowRightBlock}>
                            <div className={styles.rowTopLine}>
                              <span className={styles.statusBadge} data-tone={statusTone}>
                                {getWorkItemStatusLabel(item.status)}
                              </span>

                              <span className={styles.priority} data-priority={priorityMeta.tone}>
                                <strong>{priorityMeta.symbol}</strong>
                                {priorityMeta.label}
                              </span>
                            </div>

                            <div className={styles.rowBottomLine}>
                              {item.dueDate ? (
                                <span className={styles.metaDueDate}>
                                  {item.status !== 'done' &&
                                  (dueScheduleInfo.scheduleType === 'dueSoon' || dueScheduleInfo.scheduleType === 'overdue') ? (
                                    <span
                                      className={styles.dueUrgentMark}
                                      data-tone={dueScheduleInfo.tone}
                                      title={dueScheduleInfo.label}
                                    >
                                      !
                                    </span>
                                  ) : null}
                                  <Icon name="calendar" size={12} />
                                  <span>{formatWorkspaceShortDate(item.dueDate)}</span>
                                </span>
                              ) : (
                                <span className={styles.emptyDueDate}>-</span>
                              )}
                            </div>
                          </div>
                        </div>

                        {showDeletedTasks && (
                          <span role="cell" className={styles.actionCell}>
                            <button
                              type="button"
                              className={styles.trashRestoreButton}
                              onClick={() => handleRestoreClick(item)}
                              title="업무 복구하기"
                            >
                              <Icon name="restore" size={12} />
                              <span>복구</span>
                            </button>
                          </span>
                        )}
                      </div>
                    )
                  })
                ) : (
                  <div className={styles.emptyState}>
                    <p>표시할 업무가 없습니다.</p>
                  </div>
                )}
              </div>
            </div>

            <footer className={styles.tableFooter}>
              <Link to={createHref} className={styles.addTaskLink}>
                <Icon name="plus" size={15} />
                새 업무 추가
              </Link>

              {pageCount > 1 ? (
                <nav className={styles.pagination} aria-label="페이지 이동">
                  <span className={styles.paginationSummary}>
                    {activePage} / {pageCount} 페이지
                  </span>
                  <button
                    type="button"
                    className={styles.pageButton}
                    disabled={activePage === 1}
                    onClick={() => setCurrentPage(activePage - 1)}
                    aria-label="이전 페이지"
                  >
                    <Icon name="chevronLeft" size={14} />
                  </button>
                  {visiblePageNumbers.map((pageNumber) => (
                    <button
                      key={pageNumber}
                      type="button"
                      className={[
                        styles.pageButton,
                        pageNumber === activePage ? styles.pageButtonActive : '',
                      ].join(' ')}
                      onClick={() => setCurrentPage(pageNumber)}
                    >
                      {pageNumber}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={styles.pageButton}
                    disabled={activePage === pageCount}
                    onClick={() => setCurrentPage(activePage + 1)}
                    aria-label="다음 페이지"
                  >
                    <Icon name="chevronRight" size={14} />
                  </button>
                </nav>
              ) : null}
            </footer>
          </div>
        )}

        {!showDeletedTasks && filterLayout === 'sidebar' && isFilterOpen ? (
          <aside className={styles.filterPanel} aria-label="업무 필터">
            <div className={styles.filterHeader}>
              <strong>필터</strong>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => setIsFilterOpen(false)}
                aria-label="필터 닫기"
              >
                <Icon name="close" size={14} />
              </button>
            </div>

            <div className={styles.filterBody}>
              <label className={styles.filterGroup}>
                <span>검색</span>
                <span className={styles.searchField}>
                  <Icon name="search" size={14} />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(event) => {
                      setSearchQuery(event.target.value)
                      setCurrentPage(1)
                    }}
                    placeholder="업무 검색..."
                  />
                </span>
              </label>

              <label className={styles.filterGroup}>
                <span>담당자</span>
                <span className={styles.selectField}>
                  <select
                    value={ownerFilter}
                    onChange={(event) => {
                      setOwnerFilter(event.target.value)
                      setCurrentPage(1)
                    }}
                  >
                    <option value="all">전체</option>
                    {ownerOptions.map((member) => (
                      <option key={member.userId} value={member.userId}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                  <Icon name="chevronDown" size={13} />
                </span>
              </label>

              <fieldset className={styles.statusFilters}>
                <legend>상태</legend>
                {WORK_ITEM_STATUSES.map((status) => (
                  <label key={status}>
                    <input
                      type="checkbox"
                      checked={statusFilters[status]}
                      onChange={() => {
                        setStatusFilters((current) => ({ ...current, [status]: !current[status] }))
                        setCurrentPage(1)
                      }}
                    />
                    {getWorkItemStatusLabel(status)}
                  </label>
                ))}
              </fieldset>

              <label className={styles.filterGroup}>
                <span>일정/마감</span>
                <span className={styles.selectField}>
                  <select
                    value={scheduleFilter}
                    onChange={(event) => {
                      setScheduleFilter(event.target.value as DueScheduleFilter)
                      setCurrentPage(1)
                    }}
                  >
                    <option value="all">전체</option>
                    <option value="dueSoon">마감 임박 (7일 이내)</option>
                    <option value="plenty">여유 있음</option>
                    <option value="overdue">기한 지남</option>
                    <option value="none">마감일 미정</option>
                  </select>
                  <Icon name="chevronDown" size={13} />
                </span>
              </label>

              <label className={styles.filterGroup}>
                <span>우선순위</span>
                <span className={styles.selectField}>
                  <select
                    value={priorityFilter}
                    onChange={(event) => {
                      setPriorityFilter(event.target.value as PriorityFilter)
                      setCurrentPage(1)
                    }}
                  >
                    <option value="all">전체</option>
                    <option value="highest">매우 높음 (↑↑)</option>
                    <option value="high">높음 (↑)</option>
                    <option value="medium">보통 (−)</option>
                    <option value="low">낮음 (↓)</option>
                    <option value="lowest">매우 낮음 (↓↓)</option>
                  </select>
                  <Icon name="chevronDown" size={13} />
                </span>
              </label>

              <label className={styles.filterGroup}>
                <span>카테고리</span>
                <span className={styles.selectField}>
                  <select
                    value={tagFilter}
                    onChange={(event) => {
                      setTagFilter(event.target.value as TagFilter)
                      setCurrentPage(1)
                    }}
                  >
                    <option value="all">전체</option>
                    {tagOptions.map((tag) => (
                      <option key={tag.id} value={tag.id}>
                        {tag.label}
                      </option>
                    ))}
                  </select>
                  <Icon name="chevronDown" size={13} />
                </span>
              </label>
            </div>

            <button type="button" className={styles.resetButton} onClick={resetFilters}>
              필터 초기화
            </button>
          </aside>
        ) : null}
      </div>

      {restoreConfirmTarget && (
        <ConfirmRestoreModal
          isOpen={Boolean(restoreConfirmTarget)}
          title="업무 복구"
          itemName={restoreConfirmTarget.item.title}
          itemTypeLabel="업무"
          attachedFiles={restoreConfirmTarget.attachedFiles}
          childWorkItems={restoreConfirmTarget.childWorkItems}
          childCount={restoreConfirmTarget.childCount}
          onClose={() => setRestoreConfirmTarget(null)}
          onConfirm={async (cascade: boolean) => {
            const target = restoreConfirmTarget
            try {
              const { showToast } = await import('../../notification/data/toastEvents')
              const res = await restoreWorkItem(target.item.workItemId, { cascade })
              if (res.status === 'error') {
                showToast({
                  title: '업무 복구 실패',
                  content: res.message || '업무를 복구하지 못했습니다.',
                  created_at: new Date().toISOString(),
                })
              } else {
                showToast({
                  title: '업무 복구 완료',
                  content: cascade
                    ? `'${target.item.title}' 업무와 관련 하위 업무/파일이 정상 복구되었습니다.`
                    : `'${target.item.title}' 업무가 정상 복구되었습니다.`,
                  created_at: new Date().toISOString(),
                })
              }
            } catch (err) {
              const { showToast } = await import('../../notification/data/toastEvents')
              showToast({
                title: '업무 복구 실패',
                content: err instanceof Error ? err.message : '업무를 복구하지 못했습니다.',
                created_at: new Date().toISOString(),
              })
            } finally {
              setRestoreConfirmTarget(null)
            }
          }}
        />
      )}
    </section>
  )
}
