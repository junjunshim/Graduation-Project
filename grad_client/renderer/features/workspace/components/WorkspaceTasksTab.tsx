import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import { formatWorkspaceShortDate } from '../model/formatters'
import { getWorkItemStatusLabel, getWorkItemStatusTone } from '../model/labels'
import type { RoleMember, WorkItemRecord, WorkItemStatus } from '../model/types'
import { getWorkItemTag, WORK_ITEM_TAGS } from '../model/workItemTags'
import type { WorkItemTagId } from '../model/workItemTags'
import styles from './WorkspaceTasksTab.module.css'

type WorkspaceTasksTabProps = {
  workItems: WorkItemRecord[]
  members: RoleMember[]
}

type PriorityFilter = 'all' | 'high' | 'medium' | 'low'
type TagFilter = 'all' | WorkItemTagId

const WORK_ITEM_STATUSES: WorkItemStatus[] = ['done', 'in-progress', 'todo']
const PAGE_SIZE = 10
const MAX_PAGE_COUNT = 5
const MAX_VISIBLE_WORK_ITEMS = PAGE_SIZE * MAX_PAGE_COUNT
const INITIAL_STATUS_FILTERS: Record<WorkItemStatus, boolean> = {
  done: true,
  'in-progress': true,
  todo: true,
}

function getMemberName(userId: string, members: RoleMember[]) {
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

export function WorkspaceTasksTab({ workItems, members }: WorkspaceTasksTabProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [ownerFilter, setOwnerFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all')
  const [tagFilter, setTagFilter] = useState<TagFilter>('all')
  const [statusFilters, setStatusFilters] = useState(INITIAL_STATUS_FILTERS)
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

  const filteredWorkItems = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLocaleLowerCase('ko-KR')

    return workItems.filter((item) => {
      const ownerName = getMemberName(item.ownerUserId, members)
      const matchesQuery =
        normalizedQuery.length === 0 ||
        item.title.toLocaleLowerCase('ko-KR').includes(normalizedQuery) ||
        ownerName.toLocaleLowerCase('ko-KR').includes(normalizedQuery)
      const matchesOwner = ownerFilter === 'all' || item.ownerUserId === ownerFilter
      const matchesStatus = statusFilters[item.status]
      const matchesPriority =
        priorityFilter === 'all' || getPriorityMeta(item.priority).filter === priorityFilter
      const matchesTag = tagFilter === 'all' || getWorkItemTag(item)?.id === tagFilter

      return matchesQuery && matchesOwner && matchesStatus && matchesPriority && matchesTag
    })
  }, [members, ownerFilter, priorityFilter, searchQuery, statusFilters, tagFilter, workItems])

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
    setOwnerFilter('all')
    setPriorityFilter('all')
    setTagFilter('all')
    setStatusFilters(INITIAL_STATUS_FILTERS)
    setCurrentPage(1)
  }

  return (
    <section className={styles.panel} aria-labelledby="workspace-tasks-title">
      <header className={styles.pageHeader}>
        <div>
          <h2 id="workspace-tasks-title">업무 목록</h2>
        </div>

        <div className={styles.headerActions}>
          {!isFilterOpen ? (
            <button type="button" className={styles.secondaryButton} onClick={() => setIsFilterOpen(true)}>
              필터 열기
            </button>
          ) : null}
          
        </div>
      </header>

      <div className={[styles.contentGrid, !isFilterOpen ? styles.contentGridFull : ''].filter(Boolean).join(' ')}>
        <div className={styles.tableCard}>
          <div className={styles.tableScroller} role="table" aria-label="워크스페이스 업무 목록">
            <div className={styles.tableHeader} role="row">
              <span role="columnheader" className={styles.checkboxCell}>
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleAllVisible}
                  aria-label="현재 페이지 업무 전체 선택"
                />
              </span>
              <span role="columnheader">업무명</span>
              <span role="columnheader" className={styles.ownerHeader}>담당자</span>
              <span role="columnheader" className={styles.statusCell}>상태</span>
              <span role="columnheader">우선순위</span>
              <span role="columnheader">마감일</span>
              <span role="columnheader" className={styles.tagCell}>카테고리</span>
              <span role="columnheader" className={styles.commentCell} aria-label="댓글" />
              <span role="columnheader" className={styles.actionCell}>
                <button
                  type="button"
                  className={styles.iconButton}
                  disabled
                  aria-label="업무 목록 메뉴 기능 개발 예정"
                  title="업무 목록 메뉴 기능 개발 예정"
                >
                  <span className={styles.moreDots} aria-hidden="true" />
                </button>
              </span>
            </div>

            {filteredWorkItems.length > 0 ? (
              <div role="rowgroup">
                {pagedWorkItems.map((item) => {
                  const priority = getPriorityMeta(item.priority)
                  const tag = getWorkItemTag(item)

                  return (
                    <div key={item.workItemId} className={styles.taskRow} role="row">
                      <span role="cell" className={styles.checkboxCell}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(item.workItemId)}
                          onChange={() => toggleSelected(item.workItemId)}
                          aria-label={`${item.title} 선택`}
                        />
                      </span>
                      <span role="cell" className={styles.titleCell}>
                        <Link to={`/work-items/${item.workItemId}`}>{item.title}</Link>
                      </span>
                      <span role="cell" className={styles.ownerCell}>
                        <span className={styles.ownerIcon} aria-hidden="true">
                          <Icon name="user" size={13} />
                        </span>
                        <span className={styles.ownerName}>
                          {getMemberName(item.ownerUserId, members)}
                        </span>
                      </span>
                      <span role="cell" className={styles.statusCell}>
                        <span className={styles.statusBadge} data-tone={getWorkItemStatusTone(item.status)}>
                          {getWorkItemStatusLabel(item.status)}
                        </span>
                      </span>
                      <span role="cell" className={styles.priority} data-priority={priority.filter}>
                        <strong>{priority.symbol}</strong>
                        {priority.label}
                      </span>
                      <time role="cell" dateTime={item.dueDate} className={styles.dueDate}>
                        {formatWorkspaceShortDate(item.dueDate)}
                      </time>
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
                          disabled
                          aria-label={`${item.title} 댓글 기능 개발 예정`}
                          title="댓글 기능 개발 예정"
                        >
                          <Icon name="messageCircle" size={15} strokeWidth={2.5}/>
                        </button>
                      </span>
                      <span role="cell" className={styles.actionCell}>
                        <Link
                          to={`/work-items/${item.workItemId}/edit`}
                          className={styles.iconButton}
                          aria-label={`${item.title} 수정`}
                        >
                          <span className={styles.moreDots} aria-hidden="true" />
                        </Link>
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className={styles.emptyState}>
                <strong>조건에 맞는 업무가 없습니다.</strong>
                <span>필터를 변경하거나 새 업무를 등록해 주세요.</span>
              </div>
            )}
          </div>

          <footer className={styles.tableFooter}>
            <Link to="/work-items/new" className={styles.addTaskLink}>
              <Icon name="plus" size={15} />
              새 업무 추가
            </Link>

            {filteredWorkItems.length > 0 ? (
              <nav className={styles.pagination} aria-label="업무 목록 페이지">
                <span className={styles.paginationSummary}>
                  {pageStartIndex + 1}-{Math.min(pageStartIndex + PAGE_SIZE, visibleWorkItems.length)} /{' '}
                  {visibleWorkItems.length}
                </span>
                <button
                  type="button"
                  className={styles.pageButton}
                  disabled={activePage === 1}
                  onClick={() => setCurrentPage(1)}
                  aria-label="첫 페이지"
                >
                  <Icon name="firstPage" size={14} />
                </button>
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
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => setCurrentPage(pageNumber)}
                    aria-label={`${pageNumber}페이지`}
                    aria-current={pageNumber === activePage ? 'page' : undefined}
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

        {isFilterOpen ? (
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
                    {Object.entries(WORK_ITEM_TAGS).map(([tagId, tag]) => (
                      <option key={tagId} value={tagId}>
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
