import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '../../../design-system/primitives/Button'
import { Icon } from '../../../design-system/primitives/Icon'
import { UserAvatar } from '../../../design-system/primitives/UserAvatar'
import { formatWorkspaceShortDate } from '../model/formatters'
import { getWorkItemStatusLabel, getWorkItemStatusTone } from '../model/labels'
import type { OrganizationNodeRecord, UserRecord, WorkItemRecord, WorkItemStatus } from '../model/types'
import { getWorkItemTag } from '../model/workItemTags'
import type { WorkItemTagId } from '../model/workItemTags'
import styles from './WorkspaceTasksTab.module.css'

type WorkspaceTasksTabProps = {
  workItems: WorkItemRecord[]
  members: Array<Pick<UserRecord, 'userId' | 'name'>>
  workspaces?: Array<Pick<OrganizationNodeRecord, 'id' | 'name' | 'nodeType' | 'path'>>
  tableLabel?: string
  createHref?: string
  filterLayout?: 'sidebar' | 'toolbar'
  showHeading?: boolean
}

export type TaskViewMode = 'list' | 'tree'

type PriorityFilter = 'all' | 'high' | 'medium' | 'low'
type TagFilter = 'all' | WorkItemTagId
type StatusFilter = 'all' | WorkItemStatus

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

function getMemberName(userId: string, members: Array<Pick<UserRecord, 'userId' | 'name'>>) {
  return members.find((member) => member.userId === userId)?.name ?? '미지정'
}

function getPriorityMeta(priority: number) {
  if (priority <= 1) {
    return { filter: 'high' as const, label: '높음', symbol: '↑' }
  }

  if (priority <= 3) {
    return { filter: 'medium' as const, label: '보통', symbol: '−' }
  }

  return { filter: 'low' as const, label: '낮음', symbol: '↓' }
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
}: {
  node: TaskTreeNode
  depth?: number
  members: Array<Pick<UserRecord, 'userId' | 'name'>>
  collapsedMap: ReadonlyMap<string, boolean>
  onToggleCollapse: (id: string) => void
}) {
  const { item, children } = node
  const hasChildren = children.length > 0
  const isCollapsed = collapsedMap.get(item.workItemId) ?? false
  const statusTone = getWorkItemStatusTone(item.status)
  const priorityMeta = getPriorityMeta(item.priority)
  const tag = getWorkItemTag(item)
  const ownerName = getMemberName(item.ownerUserId, members)
  const dueDate = item.dueDate ? formatWorkspaceShortDate(item.dueDate) : null

  return (
    <div className={styles.treeNodeContainer} style={{ '--tree-depth': depth } as React.CSSProperties}>
      <div className={styles.treeCard}>
        <div className={styles.treeCardMain}>
          <div className={styles.treeCardLeft}>
            {hasChildren ? (
              <button
                type="button"
                className={styles.treeExpandButton}
                onClick={() => onToggleCollapse(item.workItemId)}
                aria-label={isCollapsed ? '하위 업무 펼치기' : '하위 업무 접기'}
              >
                <Icon name={isCollapsed ? 'chevronRight' : 'chevronDown'} size={14} />
              </button>
            ) : (
              <span className={styles.treeLeafDot} />
            )}

            <div className={styles.treeCardTitleGroup}>
              <Link to={`/work-items?view=detail&id=${item.workItemId}`} className={styles.treeCardTitle}>
                {item.title}
              </Link>
              {item.description ? (
                <p className={styles.treeCardDescription}>{item.description}</p>
              ) : null}
            </div>
          </div>

          <div className={styles.treeCardMetaGroup}>
            {tag ? (
              <span className={styles.tagBadge} data-tone={tag.tone}>
                {tag.label}
              </span>
            ) : null}

            <span className={styles.statusBadge} data-tone={statusTone}>
              {getWorkItemStatusLabel(item.status)}
            </span>

            <span className={styles.priority} data-priority={priorityMeta.filter}>
              <strong>{priorityMeta.symbol}</strong>
              {priorityMeta.label}
            </span>

            {dueDate ? (
              <span className={styles.treeDueDate}>
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
                하위 {children.length}건
              </span>
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
}: {
  trees: TaskTreeNode[]
  members: Array<Pick<UserRecord, 'userId' | 'name'>>
  totalCount: number
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
          />
        ))}
      </div>
    </div>
  )
}

export function WorkspaceTasksTab({
  workItems,
  members,
  workspaces = [],
  tableLabel = '워크스페이스 업무 목록',
  createHref = '/work-items?view=create',
  filterLayout = 'sidebar',
  showHeading = true,
}: WorkspaceTasksTabProps) {
  const [viewMode, setViewMode] = useState<TaskViewMode>('list')
  const [searchQuery, setSearchQuery] = useState('')
  const [workspaceFilter, setWorkspaceFilter] = useState('all')
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all')
  const [tagFilter, setTagFilter] = useState<TagFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [statusFilters, setStatusFilters] = useState(INITIAL_STATUS_FILTERS)
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [isFilterOpen, setIsFilterOpen] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)

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

  const filteredWorkItems = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase('ko-KR')

    return workItems.filter((item) => {
      const selectedWorkspace = workspaceOptions.find(
        (workspace) => String(workspace.id) === workspaceFilter,
      )
      const ownerWorkspace = workspaces.find((workspace) => workspace.id === item.ownerNodeId)
      const matchesWorkspace =
        workspaceFilter === 'all' ||
        (selectedWorkspace !== undefined &&
          ownerWorkspace !== undefined &&
          (ownerWorkspace.id === selectedWorkspace.id || ownerWorkspace.path.includes(selectedWorkspace.id)))
      const ownerName = getMemberName(item.ownerUserId, members)
      const matchesQuery =
        normalizedQuery.length === 0 ||
        item.title.toLocaleLowerCase('ko-KR').includes(normalizedQuery) ||
        (filterLayout === 'sidebar' && ownerName.toLocaleLowerCase('ko-KR').includes(normalizedQuery))
      const matchesOwner = ownerFilter === 'all' || item.ownerUserId === ownerFilter
      const matchesStatus =
        filterLayout === 'toolbar'
          ? statusFilter === 'all' || item.status === statusFilter
          : statusFilters[item.status]
      const matchesPriority =
        priorityFilter === 'all' || getPriorityMeta(item.priority).filter === priorityFilter
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
    searchQuery,
    statusFilter,
    statusFilters,
    tagFilter,
    workspaceFilter,
    workspaceOptions,
    workspaces,
    workItems,
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
    setStatusFilters(INITIAL_STATUS_FILTERS)
    setRangeStart('')
    setRangeEnd('')
    setCurrentPage(1)
  }

  const taskTrees = useMemo(() => buildTaskTrees(filteredWorkItems), [filteredWorkItems])

  return (
    <section
      className={styles.panel}
      aria-labelledby={showHeading ? 'workspace-tasks-title' : undefined}
      aria-label={showHeading ? undefined : tableLabel}
    >
      {showHeading ? (
        <header className={styles.pageHeader}>
          <div className={styles.pageHeaderTitleGroup}>
            <h2 id="workspace-tasks-title">
              {viewMode === 'list' ? '업무 목록' : '업무 트리'}
            </h2>
            <p>
              {viewMode === 'list'
                ? '워크스페이스에 등록된 모든 업무를 표 형태로 조회하고 관리합니다.'
                : '루트 업무부터 하위 세부 과제까지 계층 구조로 한눈에 파악합니다.'}
            </p>
          </div>

          <div className={styles.headerActions}>
            <div className={styles.viewSegmentGroup} role="group" aria-label="업무 보기 방식">
              <Button
                type="button"
                variant={viewMode === 'list' ? 'primary' : 'secondary'}
                className={[styles.viewSegmentButton, viewMode === 'list' ? styles.viewSegmentActive : ''].join(' ')}
                aria-pressed={viewMode === 'list'}
                onClick={() => setViewMode('list')}
              >
                <Icon name="list" size={15} />
                업무 목록
              </Button>
              <Button
                type="button"
                variant={viewMode === 'tree' ? 'primary' : 'secondary'}
                className={[styles.viewSegmentButton, viewMode === 'tree' ? styles.viewSegmentActive : ''].join(' ')}
                aria-pressed={viewMode === 'tree'}
                onClick={() => setViewMode('tree')}
              >
                <Icon name="orgChart" size={15} />
                업무 트리
              </Button>
            </div>

            {filterLayout === 'sidebar' && !isFilterOpen ? (
              <button type="button" className={styles.secondaryButton} onClick={() => setIsFilterOpen(true)}>
                필터 열기
              </button>
            ) : null}
          </div>
        </header>
      ) : null}

      {filterLayout === 'toolbar' ? (
        <div className={styles.listToolbar} aria-label="업무 목록 필터">
          <label className={styles.toolbarField}>
            <span className={styles.visuallyHidden}>워크스페이스</span>
            <select
              value={workspaceFilter}
              onChange={(event) => {
                setWorkspaceFilter(event.target.value)
                setCurrentPage(1)
              }}
            >
              <option value="all">워크스페이스</option>
              {workspaceOptions.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
              ))}
            </select>
            <Icon name="chevronDown" size={14} />
          </label>

          <label className={styles.toolbarField}>
            <span className={styles.visuallyHidden}>카테고리</span>
            <select
              value={tagFilter}
              onChange={(event) => {
                setTagFilter(event.target.value as TagFilter)
                setCurrentPage(1)
              }}
            >
              <option value="all">전체 카테고리</option>
              {tagOptions.map((tag) => (
                <option key={tag.id} value={tag.id}>{tag.label}</option>
              ))}
            </select>
            <Icon name="chevronDown" size={14} />
          </label>

          <label className={styles.toolbarField}>
            <span className={styles.visuallyHidden}>상태</span>
            <select
              value={statusFilter}
              onChange={(event) => {
                setStatusFilter(event.target.value as StatusFilter)
                setCurrentPage(1)
              }}
            >
              <option value="all">전체 상태</option>
              {WORK_ITEM_STATUSES.map((status) => (
                <option key={status} value={status}>{getWorkItemStatusLabel(status)}</option>
              ))}
            </select>
            <Icon name="chevronDown" size={14} />
          </label>

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

      <div
        className={[
          styles.contentGrid,
          filterLayout === 'toolbar' || !isFilterOpen ? styles.contentGridFull : '',
        ].filter(Boolean).join(' ')}
      >
        {viewMode === 'tree' ? (
          <TaskTreeView
            trees={taskTrees}
            members={members}
            totalCount={filteredWorkItems.length}
          />
        ) : (
          <div className={styles.tableCard}>
            <div className={styles.tableScroller} role="table" aria-label={tableLabel}>
              <div className={styles.tableHeader} role="row">
                <span role="columnheader" className={styles.checkboxCell}>
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={toggleAllVisible}
                    aria-label="현재 페이지 업무 전체 선택"
                  />
                </span>
                <span role="columnheader" className={styles.titleHeader}>업무명</span>
                <span role="columnheader" className={styles.ownerHeader}>담당자</span>
                <span role="columnheader" className={styles.statusCell}>상태</span>
                <span role="columnheader" className={styles.priorityHeader}>우선순위</span>
                <span role="columnheader" className={styles.dueDateHeader}>마감일</span>
                <span role="columnheader" className={styles.tagCell}>카테고리</span>
                <span role="columnheader" className={styles.commentCell} aria-label="댓글" />
                <span role="columnheader" className={styles.actionCell} aria-label="작업" />
              </div>

              <div className={styles.tableBody} role="rowgroup">
                {pagedWorkItems.length > 0 ? (
                  pagedWorkItems.map((item) => {
                    const isSelected = selectedIds.has(item.workItemId)
                    const ownerName = getMemberName(item.ownerUserId, members)
                    const statusTone = getWorkItemStatusTone(item.status)
                    const priorityMeta = getPriorityMeta(item.priority)
                    const tag = getWorkItemTag(item)

                    return (
                      <div
                        key={item.workItemId}
                        className={[styles.taskRow, isSelected ? styles.taskRowSelected : ''].join(' ')}
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

                        <span role="cell" className={styles.titleCell}>
                          <Link to={`/work-items?view=detail&id=${item.workItemId}`} className={styles.taskTitle}>
                            {item.title}
                          </Link>
                        </span>

                        <span role="cell" className={styles.ownerCell}>
                          <UserAvatar name={ownerName} userId={item.ownerUserId} size="small" />
                          <span className={styles.ownerName}>{ownerName}</span>
                        </span>

                        <span role="cell" className={styles.statusCell}>
                          <span className={styles.statusBadge} data-tone={statusTone}>
                            {getWorkItemStatusLabel(item.status)}
                          </span>
                        </span>

                        <span role="cell" className={styles.priorityCell}>
                          <span className={styles.priority} data-priority={priorityMeta.filter}>
                            <strong>{priorityMeta.symbol}</strong>
                            {priorityMeta.label}
                          </span>
                        </span>

                        <span role="cell" className={styles.dueDateCell}>
                          {item.dueDate ? (
                            <span className={styles.dueDate}>{formatWorkspaceShortDate(item.dueDate)}</span>
                          ) : (
                            <span className={styles.emptyDueDate}>-</span>
                          )}
                        </span>

                        <span role="cell" className={styles.tagCell}>
                          {tag ? (
                            <span className={styles.tagBadge} data-tone={tag.tone}>
                              {tag.label}
                            </span>
                          ) : (
                            <span className={styles.emptyTag}>-</span>
                          )}
                        </span>

                        <span role="cell" className={styles.commentCell}>
                          <button
                            type="button"
                            className={styles.commentButton}
                            disabled={!item.commentCount}
                            title={item.commentCount ? `댓글 ${item.commentCount}개` : '댓글 없음'}
                          >
                            <Icon name="messageCircle" size={14} />
                            {item.commentCount ? <span>{item.commentCount}</span> : null}
                          </button>
                        </span>

                        <span role="cell" className={styles.actionCell}>
                          <Link
                            to={`/work-items?view=edit&id=${item.workItemId}`}
                            className={styles.iconButton}
                            title="업무 수정"
                          >
                            <span className={styles.moreDots} aria-hidden="true" />
                          </Link>
                        </span>
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

        {filterLayout === 'sidebar' && isFilterOpen ? (
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
                    <option value="high">높음</option>
                    <option value="medium">보통</option>
                    <option value="low">낮음</option>
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
    </section>
  )
}
