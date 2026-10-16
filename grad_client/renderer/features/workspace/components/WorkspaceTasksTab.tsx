import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import { UserAvatar } from '../../../design-system/primitives/UserAvatar'
import { formatWorkspaceShortDateDot } from '../model/formatters'
import {
  getWorkItemStatusLabel,
  getWorkItemStatusTone,
} from '../model/labels'
import type { OrganizationNodeRecord, UserRecord, WorkItemRecord, WorkItemStatus } from '../model/types'
import { getWorkItemTag } from '../model/workItemTags'
import type { WorkItemTagId } from '../model/workItemTags'
import { calculateOverallProgress } from '../model/workItemProgress'
import { getWorkItemDueScheduleInfo, parseWorkspaceDay } from '../model/workItemDue'
import type { DueScheduleType } from '../model/workItemDue'
import { canRestoreWorkItem } from '../model/workItemPermission'
import { getCurrentUser } from '../../auth/api'
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
  filterMembers?: WorkspaceTasksTabProps['members']
  workspaces?: Array<Pick<OrganizationNodeRecord, 'id' | 'name' | 'nodeType' | 'path'>>
  tableLabel?: string
  createHref?: string
  filterLayout?: 'sidebar' | 'toolbar'
  showHeading?: boolean
  initialStatus?: string | null
  initialSchedule?: string | null
  viewMode?: TaskViewMode
  onViewModeChange?: (mode: TaskViewMode) => void
}

export type TaskViewMode = 'list' | 'tree'

type TagFilter = 'all' | WorkItemTagId
type StatusFilter = 'all' | WorkItemStatus
type DueScheduleFilter = 'all' | DueScheduleType

type TaskTreeNode = {
  item: WorkItemRecord
  children: TaskTreeNode[]
}

const WORK_ITEM_STATUSES: WorkItemStatus[] = ['in-progress', 'todo', 'done']

function getMemberName(
  userId: string,
  members: Array<Pick<UserRecord, 'userId' | 'name'> & Partial<Pick<UserRecord, 'email'>>>,
) {
  const found = members.find((member) => member.userId === userId || (member.email && member.email === userId))
  if (found) return found.name
  if (userId && !userId.startsWith('U-') && !userId.includes('@')) return userId
  return '미지정'
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

/** 진행률 게이지 바 + 텍스트 컴포넌트 */
function TaskProgressBar({
  item,
  children = [],
}: {
  item: WorkItemRecord
  children?: Array<{ progress: number; computedProgress?: number }>
}) {
  const progressDetail = calculateOverallProgress(item, children)

  const tooltipText = progressDetail.hasChildren
    ? `자체 진행률: ${progressDetail.selfProgress}% | 하위 평균: ${progressDetail.childAverage}% (가중치 반영 종합: ${progressDetail.finalProgress}%)`
    : `진행률: ${progressDetail.selfProgress}%`

  return (
    <div className={styles.colProgress} title={tooltipText}>
      <div className={styles.progressBarTrack}>
        <div
          className={styles.progressBarFill}
          data-status={item.status}
          style={{ width: `${Math.max(0, Math.min(100, progressDetail.finalProgress))}%` }}
        />
      </div>
      <span className={styles.progressText}>{progressDetail.finalProgress}%</span>
    </div>
  )
}

/** 트리 뷰 개별 행 컴포넌트 (UI_1) */
function ModernTreeNodeRow({
  node,
  depth = 0,
  members,
  collapsedMap,
  onToggleCollapse,
  isTrashMode = false,
  onRestore,
  canRestoreItem,
  onContextMenu,
}: {
  node: TaskTreeNode
  depth?: number
  members: WorkspaceTasksTabProps['members']
  collapsedMap: ReadonlyMap<string, boolean>
  onToggleCollapse: (id: string) => void
  isTrashMode?: boolean
  onRestore?: (item: WorkItemRecord) => void
  canRestoreItem?: (item: WorkItemRecord) => boolean
  onContextMenu?: (e: React.MouseEvent, id: string) => void
}) {
  const { item, children } = node
  const hasChildren = children.length > 0
  const isCollapsed = collapsedMap.get(item.workItemId) ?? false
  const ownerName = getMemberName(item.ownerUserId, members)
  const statusTone = getWorkItemStatusTone(item.status)
  const restorable = canRestoreItem ? canRestoreItem(item) : true

  return (
    <div className={styles.treeNodeContainer}>
      <div
        className={styles.modernGridRow}
        data-work-item-id={item.workItemId}
        onContextMenu={(e) => onContextMenu?.(e, item.workItemId)}
      >
        {/* 컬럼 1: 업무 트리 계층 인덴트 + 제목 + 카테고리 태그 */}
        <div className={styles.colTreeTitle} style={{ paddingLeft: `${depth * 20}px` }}>
          {depth > 0 && <span className={styles.treeConnectorLine} />}
          {hasChildren ? (
            <button
              type="button"
              className={styles.treeToggleIcon}
              onClick={() => onToggleCollapse(item.workItemId)}
              aria-label={isCollapsed ? '펼치기' : '접기'}
            >
              <Icon name={isCollapsed ? 'chevronRight' : 'chevronDown'} size={14} />
            </button>
          ) : (
            <span className={styles.treeLeafDotSmall} />
          )}

          <Link to={`/work-items/${item.workItemId}`} className={styles.colTaskNameLink} title={item.title}>
            {item.title}
          </Link>

          {item.category ? (
            <>
              <span className={styles.categoryTagSep}>|</span>
              <span className={styles.categoryTagText}>{item.category}</span>
            </>
          ) : null}
        </div>

        {/* 컬럼 2: 담당자 */}
        <div className={styles.colAssignee}>
          <UserAvatar name={ownerName} userId={item.ownerUserId} size="small" />
          <span className={styles.assigneeName}>{ownerName}</span>
        </div>

        {/* 컬럼 3: 상태 */}
        <div className={styles.colStatus}>
          <span className={styles.statusIndicatorDot} data-status={statusTone} />
          <span>{getWorkItemStatusLabel(item.status)}</span>
        </div>

        {/* 컬럼 4: 마감일 */}
        <div className={styles.colDueDate}>
          {formatWorkspaceShortDateDot(item.dueDate)}
        </div>

        {/* 컬럼 5: 진행률 */}
        <TaskProgressBar item={item} children={children.map((c) => c.item)} />

        {/* 컬럼 6: 댓글 */}
        <div className={styles.colComments}>
          <Icon name="messageCircle" size={14} />
          <span>{item.commentCount ?? 0}</span>
        </div>

        {/* 컬럼 7: 액션 */}
        <div className={styles.colActions}>
          {isTrashMode && onRestore ? (
            <button
              type="button"
              className={styles.trashRestoreButton}
              onClick={() => onRestore(item)}
              disabled={!restorable}
              title={restorable ? '업무 복구하기' : '업무를 복구할 권한이 없습니다.'}
            >
              <Icon name="restore" size={12} />
              <span>복구</span>
            </button>
          ) : (
            <button
              type="button"
              className={styles.moreDotsBtn}
              onClick={(e) => onContextMenu?.(e, item.workItemId)}
              aria-label="추가 옵션"
            >
              <Icon name="moreVertical" size={15} />
            </button>
          )}
        </div>
      </div>

      {hasChildren && !isCollapsed && (
        <div className={styles.treeChildrenWrapper}>
          {children.map((child) => (
            <ModernTreeNodeRow
              key={child.item.workItemId}
              node={child}
              depth={depth + 1}
              members={members}
              collapsedMap={collapsedMap}
              onToggleCollapse={onToggleCollapse}
              isTrashMode={isTrashMode}
              onRestore={onRestore}
              canRestoreItem={canRestoreItem}
              onContextMenu={onContextMenu}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function WorkspaceTasksTab({
  workItems,
  deletedWorkItems = [],
  allWorkItems = [],
  members,
  filterMembers = members,
  workspaces: _workspaces = [],
  createHref,
  initialStatus,
  initialSchedule,
  viewMode: controlledViewMode,
  onViewModeChange: _onViewModeChange,
}: WorkspaceTasksTabProps) {
  const { onWorkItemContextMenu, workItemContextMenu } = useWorkItemContextMenu()

  const canRestoreItem = useCallback((item: WorkItemRecord) => {
    const snapshot = getOrgSnapshot()
    return canRestoreWorkItem(item, getCurrentUser(snapshot)?.userId ?? null, snapshot)
  }, [])

  const viewMode = controlledViewMode ?? 'list'
  const [showDeletedTasks, setShowDeletedTasks] = useState(false)
  const [restoreConfirmTarget, setRestoreConfirmTarget] = useState<{
    item: WorkItemRecord
    attachedFiles: Array<{ id: number; name: string; size?: number; workItemTitle?: string }>
    childWorkItems: Array<{ id: string; title: string }>
    childCount: number
  } | null>(null)

  const [searchQuery, setSearchQuery] = useState('')
  const [ownerFilter, setOwnerFilter] = useState('all')
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

  // 목록 뷰 그룹별 접기 상태
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})

  // 트리 뷰 접기 상태
  const [treeCollapsedMap, setTreeCollapsedMap] = useState<Map<string, boolean>>(() => new Map())

  // 체크박스 선택 상태
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())

  // 드롭다운 열림 상태
  const [openDropdown, setOpenDropdown] = useState<'owner' | 'schedule' | 'tag' | null>(null)
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

  const effectiveWorkItems = useMemo(() => {
    return showDeletedTasks ? deletedWorkItems : workItems
  }, [showDeletedTasks, deletedWorkItems, workItems])

  // 전체 및 상태별 카운트 계산
  const statusCounts = useMemo(() => {
    const items = effectiveWorkItems
    const counts = { all: items.length, 'in-progress': 0, todo: 0, done: 0 }
    items.forEach((item) => {
      if (item.status === 'in-progress') counts['in-progress']++
      else if (item.status === 'todo') counts.todo++
      else if (item.status === 'done') counts.done++
    })
    return counts
  }, [effectiveWorkItems])

  const ownerOptions = useMemo(() => {
    const ownerIds = new Set<string>()
    ;[...workItems, ...deletedWorkItems, ...allWorkItems].forEach((item) => ownerIds.add(item.ownerUserId))

    const ownersFromWorkItems = members.filter(
      (member) => ownerIds.has(member.userId) || Boolean(member.email && ownerIds.has(member.email)),
    )

    return Array.from(
      new Map(
        [...filterMembers, ...ownersFromWorkItems].map((member) => [member.userId, member]),
      ).values(),
    ).sort((left, right) => left.name.localeCompare(right.name, 'ko'))
  }, [allWorkItems, deletedWorkItems, filterMembers, members, workItems])

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

  const filteredWorkItems = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase('ko-KR')

    return effectiveWorkItems.filter((item) => {
      const ownerName = getMemberName(item.ownerUserId, members)
      const matchesQuery =
        normalizedQuery.length === 0 ||
        item.title.toLocaleLowerCase('ko-KR').includes(normalizedQuery) ||
        ownerName.toLocaleLowerCase('ko-KR').includes(normalizedQuery)

      const selectedOwner = ownerOptions.find((member) => member.userId === ownerFilter)
      const matchesOwner =
        ownerFilter === 'all' ||
        item.ownerUserId === ownerFilter ||
        Boolean(selectedOwner?.email && item.ownerUserId === selectedOwner.email)

      if (showDeletedTasks) {
        return matchesQuery && matchesOwner
      }

      const matchesStatus = statusFilter === 'all' || item.status === statusFilter

      const dueScheduleInfo = getWorkItemDueScheduleInfo(item)
      const matchesSchedule =
        scheduleFilter === 'all'
          ? true
          : scheduleFilter === 'none'
            ? parseWorkspaceDay(item.dueDate) === null
            : dueScheduleInfo.scheduleType === scheduleFilter

      const matchesTag = tagFilter === 'all' || getWorkItemTag(item)?.id === tagFilter

      return matchesQuery && matchesOwner && matchesStatus && matchesSchedule && matchesTag
    })
  }, [
    effectiveWorkItems,
    members,
    ownerFilter,
    ownerOptions,
    scheduleFilter,
    searchQuery,
    showDeletedTasks,
    statusFilter,
    tagFilter,
  ])

  // 트리 빌드
  const taskTrees = useMemo(() => buildTaskTrees(filteredWorkItems), [filteredWorkItems])

  // 트리 접기/펼치기 핸들러
  const toggleTreeCollapse = (id: string) => {
    setTreeCollapsedMap((prev) => {
      const next = new Map(prev)
      next.set(id, !next.get(id))
      return next
    })
  }

  const expandAllTrees = () => setTreeCollapsedMap(new Map())

  const collapseAllTrees = () => {
    const next = new Map<string, boolean>()
    const markAll = (nodes: TaskTreeNode[]) => {
      nodes.forEach((node) => {
        if (node.children.length > 0) {
          next.set(node.item.workItemId, true)
          markAll(node.children)
        }
      })
    }
    markAll(taskTrees)
    setTreeCollapsedMap(next)
  }

  // 그룹 접기 토글
  const toggleGroupCollapse = (status: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [status]: !prev[status] }))
  }

  // 체크박스 토글
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredWorkItems.length) {
      setSelectedIds(new Set())
    } else {
      setSelectedIds(new Set(filteredWorkItems.map((item) => item.workItemId)))
    }
  }

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleRestoreClick(item: WorkItemRecord) {
    if (!canRestoreItem(item)) {
      void import('../../notification/data/toastEvents').then(({ showToast }) => {
        showToast({
          title: '업무 복구 실패',
          content: '업무를 복구할 권한이 없습니다.',
          created_at: new Date().toISOString(),
        })
      })
      return
    }

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

  const selectedOwnerLabel = useMemo(() => {
    if (ownerFilter === 'all') return '담당자'
    const found = ownerOptions.find((o) => o.userId === ownerFilter)
    return found ? found.name : '담당자'
  }, [ownerFilter, ownerOptions])

  const selectedScheduleLabel = useMemo(() => {
    switch (scheduleFilter) {
      case 'dueSoon':
        return '마감 임박'
      case 'plenty':
        return '여유 있음'
      case 'overdue':
        return '기한 지남'
      case 'none':
        return '마감일 미정'
      default:
        return '일정/마감'
    }
  }, [scheduleFilter])

  const selectedTagLabel = useMemo(() => {
    if (tagFilter === 'all') return '카테고리'
    const found = tagOptions.find((t) => t.id === tagFilter)
    return found ? found.label : '카테고리'
  }, [tagFilter, tagOptions])

  return (
    <section className={styles.panel}>
      {!showDeletedTasks && workItemContextMenu}

      {/* 1층: 퀵 상태 필터 칩 + 우측 검색 및 필터 드롭다운들 + 휴지통 */}
      <div className={styles.modernToolbarRow} ref={toolbarRef}>
        {/* 좌측 퀵 상태 필터 칩들 */}
        <div className={styles.statusPillGroup}>
          <button
            type="button"
            className={[styles.statusPill, statusFilter === 'all' ? styles.statusPillActive : ''].join(' ')}
            data-status="all"
            onClick={() => setStatusFilter('all')}
          >
            <span>전체</span>
            <span className={styles.statusPillCount}>{statusCounts.all}</span>
          </button>
          <button
            type="button"
            className={[styles.statusPill, statusFilter === 'in-progress' ? styles.statusPillActive : ''].join(' ')}
            data-status="in-progress"
            onClick={() => setStatusFilter('in-progress')}
          >
            <span className={styles.statusPillDot} data-status="in-progress" />
            <span>진행 중</span>
            <span className={styles.statusPillCount}>{statusCounts['in-progress']}</span>
          </button>
          <button
            type="button"
            className={[styles.statusPill, statusFilter === 'todo' ? styles.statusPillActive : ''].join(' ')}
            data-status="todo"
            onClick={() => setStatusFilter('todo')}
          >
            <span className={styles.statusPillDot} data-status="todo" />
            <span>예정</span>
            <span className={styles.statusPillCount}>{statusCounts.todo}</span>
          </button>
          <button
            type="button"
            className={[styles.statusPill, statusFilter === 'done' ? styles.statusPillActive : ''].join(' ')}
            data-status="done"
            onClick={() => setStatusFilter('done')}
          >
            <span className={styles.statusPillDot} data-status="done" />
            <span>완료</span>
            <span className={styles.statusPillCount}>{statusCounts.done}</span>
          </button>
        </div>

        {/* 우측 검색창 + 담당자 + 일정/마감 + 카테고리 필터 */}
        <div className={styles.modernToolbarRight}>
          <div className={styles.modernSearchInput}>
            <Icon name="search" size={14} />
            <input
              type="search"
              placeholder="업무 검색"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          {/* 담당자 드롭다운 */}
          <div className={styles.toolbarFilterItem}>
            <button
              type="button"
              className={styles.modernDropdownTrigger}
              onClick={() => setOpenDropdown((prev) => (prev === 'owner' ? null : 'owner'))}
            >
              <span>{selectedOwnerLabel}</span>
              <Icon name="chevronDown" size={14} />
            </button>
            {openDropdown === 'owner' && (
              <div className={styles.filterDropdownMenu}>
                <button
                  type="button"
                  className={[styles.dropdownItem, ownerFilter === 'all' ? styles.dropdownItemSelected : ''].join(' ')}
                  onClick={() => {
                    setOwnerFilter('all')
                    setOpenDropdown(null)
                  }}
                >
                  전체
                </button>
                {ownerOptions.map((member) => (
                  <button
                    key={member.userId}
                    type="button"
                    className={[styles.dropdownItem, ownerFilter === member.userId ? styles.dropdownItemSelected : ''].join(' ')}
                    onClick={() => {
                      setOwnerFilter(member.userId)
                      setOpenDropdown(null)
                    }}
                  >
                    <UserAvatar name={member.name} userId={member.userId} size="small" />
                    <span>{member.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 일정/마감 아코디언 드롭다운 */}
          <div className={styles.toolbarFilterItem}>
            <button
              type="button"
              className={styles.modernDropdownTrigger}
              onClick={() => setOpenDropdown((prev) => (prev === 'schedule' ? null : 'schedule'))}
            >
              <span>{selectedScheduleLabel}</span>
              <Icon name="chevronDown" size={14} />
            </button>
            {openDropdown === 'schedule' && (
              <div className={styles.filterDropdownMenu}>
                <button
                  type="button"
                  className={[styles.dropdownItem, scheduleFilter === 'all' ? styles.dropdownItemSelected : ''].join(' ')}
                  onClick={() => {
                    setScheduleFilter('all')
                    setOpenDropdown(null)
                  }}
                >
                  전체
                </button>
                <button
                  type="button"
                  className={[styles.dropdownItem, scheduleFilter === 'dueSoon' ? styles.dropdownItemSelected : ''].join(' ')}
                  onClick={() => {
                    setScheduleFilter('dueSoon')
                    setOpenDropdown(null)
                  }}
                >
                  마감 임박 (7일 이내)
                </button>
                <button
                  type="button"
                  className={[styles.dropdownItem, scheduleFilter === 'plenty' ? styles.dropdownItemSelected : ''].join(' ')}
                  onClick={() => {
                    setScheduleFilter('plenty')
                    setOpenDropdown(null)
                  }}
                >
                  여유 있음
                </button>
                <button
                  type="button"
                  className={[styles.dropdownItem, scheduleFilter === 'overdue' ? styles.dropdownItemSelected : ''].join(' ')}
                  onClick={() => {
                    setScheduleFilter('overdue')
                    setOpenDropdown(null)
                  }}
                >
                  기한 지남
                </button>
                <button
                  type="button"
                  className={[styles.dropdownItem, scheduleFilter === 'none' ? styles.dropdownItemSelected : ''].join(' ')}
                  onClick={() => {
                    setScheduleFilter('none')
                    setOpenDropdown(null)
                  }}
                >
                  마감일 미정
                </button>
              </div>
            )}
          </div>

          {/* 카테고리 아코디언 드롭다운 */}
          <div className={styles.toolbarFilterItem}>
            <button
              type="button"
              className={styles.modernDropdownTrigger}
              onClick={() => setOpenDropdown((prev) => (prev === 'tag' ? null : 'tag'))}
            >
              <span>{selectedTagLabel}</span>
              <Icon name="chevronDown" size={14} />
            </button>
            {openDropdown === 'tag' && (
              <div className={styles.filterDropdownMenu}>
                <button
                  type="button"
                  className={[styles.dropdownItem, tagFilter === 'all' ? styles.dropdownItemSelected : ''].join(' ')}
                  onClick={() => {
                    setTagFilter('all')
                    setOpenDropdown(null)
                  }}
                >
                  전체
                </button>
                {tagOptions.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    className={[styles.dropdownItem, tagFilter === tag.id ? styles.dropdownItemSelected : ''].join(' ')}
                    onClick={() => {
                      setTagFilter(tag.id as TagFilter)
                      setOpenDropdown(null)
                    }}
                  >
                    <span>{tag.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 휴지통 토글 버튼 (카테고리 아코디언 옆) */}
          <button
            type="button"
            className={[styles.trashToggleBtn, showDeletedTasks ? styles.trashToggleBtnActive : ''].join(' ')}
            disabled={deletedWorkItems.length === 0}
            onClick={() => {
              if (deletedWorkItems.length === 0) return
              setShowDeletedTasks((prev) => !prev)
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
        </div>
      </div>

      {/* 3층: 요약 정보 (트리 뷰인 경우: 총 N개 업무 · 루트 업무 N개 / 모두 펼치기 | 모두 접기) */}
      {viewMode === 'tree' ? (
        <div className={styles.modernSummaryBar}>
          <div>
            <span className={styles.summaryTotalCount}>총 {filteredWorkItems.length}개 업무</span>
            <span className={styles.summaryRootCount}> · 루트 업무 {taskTrees.length}개</span>
          </div>
          <div className={styles.treeToggleButtons}>
            <button type="button" className={styles.treeActionBtn} onClick={expandAllTrees}>
              모두 펼치기
            </button>
            <button type="button" className={styles.treeActionBtn} onClick={collapseAllTrees}>
              모두 접기
            </button>
          </div>
        </div>
      ) : null}

      {/* 4층: 메인 콘텐츠 (트리 뷰 vs 목록 뷰) */}
      {filteredWorkItems.length === 0 ? (
        <div className={styles.modernTableCard}>
          <div className={styles.emptyState}>
            <Icon name="fileText" size={32} />
            <p>표시할 업무가 없습니다.</p>
          </div>
        </div>
      ) : viewMode === 'tree' ? (
        /* ================== 업무 트리 뷰 (UI_1) ================== */
        <div className={styles.modernTableCard}>
          {/* 헤더 */}
          <div className={styles.modernGridHeader}>
            <div>업무 트리</div>
            <div className={styles.headerCenter}>담당자</div>
            <div className={styles.headerCenter}>상태</div>
            <div className={styles.headerCenter}>마감일</div>
            <div className={styles.headerCenter}>진행률</div>
            <div className={styles.headerCenter}>댓글</div>
            <div />
          </div>

          {/* 트리 노드 목록 */}
          <div className={styles.modernTableBody}>
            {taskTrees.map((rootNode) => (
              <ModernTreeNodeRow
                key={rootNode.item.workItemId}
                node={rootNode}
                members={members}
                collapsedMap={treeCollapsedMap}
                onToggleCollapse={toggleTreeCollapse}
                isTrashMode={showDeletedTasks}
                onRestore={handleRestoreClick}
                canRestoreItem={canRestoreItem}
                onContextMenu={onWorkItemContextMenu}
              />
            ))}
          </div>
        </div>
      ) : (
        /* ================== 업무 목록 뷰 (UI_2) ================== */
        <div className={styles.modernTableCard}>
          {/* 헤더 */}
          <div className={[styles.modernGridHeader, styles.modernListHeader].join(' ')}>
            <div className={styles.headerCenter}>
              <input
                type="checkbox"
                checked={selectedIds.size === filteredWorkItems.length && filteredWorkItems.length > 0}
                onChange={toggleSelectAll}
                aria-label="전체 선택"
              />
            </div>
            <div>업무 목록</div>
            <div className={styles.headerCenter}>담당자</div>
            <div className={styles.headerCenter}>마감일</div>
            <div className={styles.headerCenter}>진행률</div>
            <div className={styles.headerCenter}>댓글</div>
            <div />
          </div>

          {/* 상태별 그룹 아코디언 */}
          <div className={styles.modernTableBody}>
            {WORK_ITEM_STATUSES.map((status) => {
              const groupItems = filteredWorkItems.filter((i) => i.status === status)
              if (groupItems.length === 0) return null
              const isCollapsed = collapsedGroups[status] ?? false

              return (
                <div key={status} className={styles.groupSection}>
                  <div
                    className={styles.groupAccordionHeader}
                    data-status={status}
                    onClick={() => toggleGroupCollapse(status)}
                  >
                    <div className={styles.groupHeaderLeft}>
                      <Icon name={isCollapsed ? 'chevronRight' : 'chevronDown'} size={14} />
                      <span className={styles.statusIndicatorDot} data-status={status} />
                      <span className={styles.groupTitle}>{getWorkItemStatusLabel(status)}</span>
                      <span className={styles.groupBadgeCount}>{groupItems.length}</span>
                    </div>

                    {createHref && (
                      <div className={styles.groupHeaderRight} onClick={(e) => e.stopPropagation()}>
                        <Link
                          to={`${createHref}${createHref.includes('?') ? '&' : '?'}status=${status}`}
                          className={styles.groupAddBtn}
                          title="이 상태로 업무 추가"
                        >
                          <Icon name="plus" size={14} />
                        </Link>
                      </div>
                    )}
                  </div>

                  {!isCollapsed &&
                    groupItems.map((item) => {
                      const isSelected = selectedIds.has(item.workItemId)
                      const ownerName = getMemberName(item.ownerUserId, members)
                      const restorable = canRestoreItem ? canRestoreItem(item) : true

                      return (
                        <div
                          key={item.workItemId}
                          className={[styles.modernGridRow, styles.modernListRow].join(' ')}
                          data-work-item-id={item.workItemId}
                          onContextMenu={(e) => onWorkItemContextMenu(e, item.workItemId)}
                        >
                          <div className={styles.colCheckbox}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectOne(item.workItemId)}
                              aria-label={`${item.title} 선택`}
                            />
                          </div>

                          <div className={styles.colTreeTitle}>
                            <Link to={`/work-items/${item.workItemId}`} className={styles.colTaskNameLink} title={item.title}>
                              {item.title}
                            </Link>
                            {item.category ? (
                              <>
                                <span className={styles.categoryTagSep}>|</span>
                                <span className={styles.categoryTagText}>{item.category}</span>
                              </>
                            ) : null}
                          </div>

                          <div className={styles.colAssignee}>
                            <UserAvatar name={ownerName} userId={item.ownerUserId} size="small" />
                            <span className={styles.assigneeName}>{ownerName}</span>
                          </div>

                          <div className={styles.colDueDate}>
                            {formatWorkspaceShortDateDot(item.dueDate)}
                          </div>

                          <TaskProgressBar item={item} />

                          <div className={styles.colComments}>
                            <Icon name="messageCircle" size={14} />
                            <span>{item.commentCount ?? 0}</span>
                          </div>

                          <div className={styles.colActions}>
                            {showDeletedTasks ? (
                              <button
                                type="button"
                                className={styles.trashRestoreButton}
                                onClick={() => handleRestoreClick(item)}
                                disabled={!restorable}
                                title={restorable ? '업무 복구하기' : '업무를 복구할 권한이 없습니다.'}
                              >
                                <Icon name="restore" size={12} />
                                <span>복구</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                className={styles.moreDotsBtn}
                                onClick={(e) => onWorkItemContextMenu(e, item.workItemId)}
                                aria-label="추가 옵션"
                              >
                                <Icon name="moreVertical" size={15} />
                              </button>
                            )}
                          </div>
                        </div>
                      )
                    })}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 5층: 하단 + 업무 추가 와이드 버튼 */}
      {!showDeletedTasks && createHref && (
        <Link to={createHref} className={styles.wideAddTaskButton}>
          <Icon name="plus" size={16} />
          <span>업무 추가</span>
        </Link>
      )}

      {/* 복구 모달 */}
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
            const { showToast } = await import('../../notification/data/toastEvents')

            if (!canRestoreItem(target.item)) {
              setRestoreConfirmTarget(null)
              showToast({
                title: '업무 복구 실패',
                content: '업무를 복구할 권한이 없습니다.',
                created_at: new Date().toISOString(),
              })
              return
            }

            try {
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
