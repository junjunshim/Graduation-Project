import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import { getCurrentUser } from '../../auth/api'
import { getOrgSnapshot } from '../data/orgService'
import {
  getActiveWorkspaceRootId,
  getDefaultWorkspaceRootId,
  selectWorkspaceRoot,
} from '../data/workspaceDirectorySelection'
import type { WorkspaceDirectoryItem, WorkspaceDirectoryTone } from '../model/workspaceDirectory'
import { getWorkspaceDirectory } from '../queries/workspaceDirectory'
import styles from './WorkspaceEntryPage.module.css'

const WORKSPACE_LIST_PAGE_SIZE = 10

const toneClassNames: Record<WorkspaceDirectoryTone, string> = {
  indigo: styles.toneIndigo,
  teal: styles.toneTeal,
  blue: styles.toneBlue,
  green: styles.toneGreen,
  violet: styles.toneViolet,
  orange: styles.toneOrange,
  pink: styles.tonePink,
}

function matchesWorkspace(item: WorkspaceDirectoryItem, query: string) {
  if (!query) {
    return true
  }

  return `${item.name} ${item.description}`.toLocaleLowerCase('ko-KR').includes(query)
}

function formatCreatedAt(createdAt: string) {
  return createdAt.replace(/-/g, '.')
}

function WorkspaceGlyph({
  item,
  variant,
}: {
  item: WorkspaceDirectoryItem
  variant: 'root' | 'branch' | 'leaf' | 'list' | 'dialog'
}) {
  return (
    <span
      className={[
        styles.workspaceGlyph,
        styles[`workspaceGlyph${variant[0].toUpperCase()}${variant.slice(1)}`],
        toneClassNames[item.tone],
      ].join(' ')}
      aria-hidden="true"
    >
      <Icon name={item.iconName} size={variant === 'leaf' ? 21 : variant === 'dialog' ? 28 : 30} />
    </span>
  )
}

function RootBadge() {
  return <span className={styles.rootBadge}>루트</span>
}

function FavoriteButton({
  isFavorite,
  label,
  onToggle,
}: {
  isFavorite: boolean
  label: string
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      className={[styles.favoriteButton, isFavorite ? styles.favoriteButtonActive : ''].filter(Boolean).join(' ')}
      aria-label={`${label} 즐겨찾기 ${isFavorite ? '해제' : '추가'}`}
      aria-pressed={isFavorite}
      onClick={(event) => {
        event.stopPropagation()
        onToggle()
      }}
    >
      <Icon name="star" size={18} />
    </button>
  )
}

function MoreButton({ label }: { label: string }) {
  return (
    <span className={styles.moreButton} title={`${label} 더보기`} aria-hidden="true">
      <Icon name="moreHorizontal" size={19} />
    </span>
  )
}

function DirectoryToolbar({
  query,
  isHelpOpen,
  onQueryChange,
  onToggleHelp,
}: {
  query: string
  isHelpOpen: boolean
  onQueryChange: (query: string) => void
  onToggleHelp: () => void
}) {
  return (
    <div className={styles.utilityBar}>
      <label className={styles.searchBox}>
        <span className={styles.srOnly}>워크스페이스 검색</span>
        <input
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="워크스페이스 검색"
        />
        <Icon name="search" size={19} />
      </label>

      <div className={styles.helpAnchor}>
        <button
          type="button"
          className={styles.helpButton}
          aria-label="워크스페이스 진입점 도움말"
          aria-expanded={isHelpOpen}
          onClick={onToggleHelp}
        >
          <Icon name="helpCircle" size={22} />
        </button>
        {isHelpOpen ? (
          <div className={styles.helpPopover} role="status">
            계층도나 목록에서 조직을 확인한 뒤 최상위 워크스페이스를 선택해 진입하세요.
          </div>
        ) : null}
      </div>

      <Link to="/setup/top-node" className={styles.createButton}>
        워크스페이스 생성
      </Link>
    </div>
  )
}

function ViewToggle({
  view,
  onChange,
}: {
  view: 'hierarchy' | 'list'
  onChange: (view: 'hierarchy' | 'list') => void
}) {
  return (
    <div className={styles.viewToggle} role="group" aria-label="워크스페이스 보기 방식">
      <button
        type="button"
        className={view === 'hierarchy' ? styles.viewButtonActive : styles.viewButton}
        aria-pressed={view === 'hierarchy'}
        onClick={() => onChange('hierarchy')}
      >
        <Icon name="orgChart" size={19} />
        계층도 보기
      </button>
      <button
        type="button"
        className={view === 'list' ? styles.viewButtonActive : styles.viewButton}
        aria-pressed={view === 'list'}
        onClick={() => onChange('list')}
      >
        <Icon name="list" size={19} />
        목록 보기
      </button>
    </div>
  )
}

function HierarchyView({
  root,
  branches,
  favoriteIds,
  onOpenChooser,
  onToggleFavorite,
}: {
  root: WorkspaceDirectoryItem
  branches: WorkspaceDirectoryItem[]
  favoriteIds: ReadonlySet<string>
  onOpenChooser: (rootId: string) => void
  onToggleFavorite: (id: string) => void
}) {
  return (
    <div className={styles.treeViewport}>
      <section className={styles.treeCanvas} aria-label={`${root.name} 워크스페이스 계층도`}>
        <button type="button" className={styles.rootCard} onClick={() => onOpenChooser(root.id)}>
          <WorkspaceGlyph item={root} variant="root" />
          <span className={styles.rootCardCopy}>
            <span className={styles.rootNameLine}>
              <strong>{root.name}</strong>
              <RootBadge />
            </span>
            <span>{root.description}</span>
            <span>
              멤버 {root.memberCount}명
              <i aria-hidden="true" />
              하위 {root.childCount}개
            </span>
          </span>
          <Icon name="chevronRight" size={20} />
        </button>

        {branches.length > 0 ? (
          <ol
            className={[
              styles.branchGrid,
              branches.length < 6 ? styles.branchGridFiltered : '',
              branches.length === 1 ? styles.branchGridSingle : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={
              branches.length < 6
                ? { gridTemplateColumns: `repeat(${branches.length}, 11.4rem)` }
                : undefined
            }
          >
            {branches.map((branch) => (
              <li className={styles.branchColumn} key={branch.id}>
                <article className={styles.branchCard}>
                  <div className={styles.branchFavorite}>
                    <FavoriteButton
                      isFavorite={favoriteIds.has(branch.id)}
                      label={branch.name}
                      onToggle={() => onToggleFavorite(branch.id)}
                    />
                  </div>
                  <div className={styles.branchMore}>
                    <MoreButton label={branch.name} />
                  </div>
                  <WorkspaceGlyph item={branch} variant="branch" />
                  <h2>{branch.name}</h2>
                  <p>{branch.description}</p>
                  <span>
                    멤버 {branch.memberCount}명
                    <i aria-hidden="true" />
                    하위 {branch.childCount}개
                  </span>
                </article>

                {branch.children.length > 0 ? (
                  <ol className={styles.leafList}>
                    {branch.children.map((child) => (
                      <li className={styles.leafCard} key={child.id}>
                        <div className={styles.leafFavorite}>
                          <FavoriteButton
                            isFavorite={favoriteIds.has(child.id)}
                            label={child.name}
                            onToggle={() => onToggleFavorite(child.id)}
                          />
                        </div>
                        <WorkspaceGlyph item={child} variant="leaf" />
                        <div className={styles.leafCopy}>
                          <strong>{child.name}</strong>
                          <span>{child.description}</span>
                          <small>멤버 {child.memberCount}명</small>
                        </div>
                        <MoreButton label={child.name} />
                      </li>
                    ))}
                  </ol>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <div className={styles.emptyState}>검색 결과와 일치하는 워크스페이스가 없습니다.</div>
        )}

        <aside className={styles.legend} aria-label="계층도 안내">
          <strong>안내</strong>
          <span>
            <Icon name="star" size={17} className={styles.legendStar} />
            즐겨찾기한 워크스페이스
          </span>
          <span>
            <i className={styles.legendRootIcon}>
              <Icon name="building" size={13} />
            </i>
            루트 워크스페이스
          </span>
          <span>
            <i className={styles.legendLeafIcon}>
              <Icon name="folder" size={13} />
            </i>
            일반 워크스페이스
          </span>
          <span>
            <i className={styles.legendConnector} />
            하위 워크스페이스
          </span>
          <span>
            <Icon name="moreHorizontal" size={17} />
            더보기 메뉴
          </span>
        </aside>
      </section>
    </div>
  )
}

function ListView({
  rows,
  favoriteIds,
  currentPage,
  pageNumbers,
  totalCount,
  onOpenChooser,
  onOpenWorkspace,
  onPageChange,
  onToggleFavorite,
}: {
  rows: WorkspaceDirectoryItem[]
  favoriteIds: ReadonlySet<string>
  currentPage: number
  pageNumbers: number[]
  totalCount: number
  onOpenChooser: (rootId: string) => void
  onOpenWorkspace: (rootId: string) => void
  onPageChange: (page: number) => void
  onToggleFavorite: (id: string) => void
}) {
  return (
    <section className={styles.listSection} aria-label="워크스페이스 목록">
      <ol className={styles.workspaceRows}>
        {rows.length > 0 ? (
          rows.map((item) => (
            <li className={styles.workspaceRow} key={item.id}>
              <FavoriteButton
                isFavorite={favoriteIds.has(item.id)}
                label={item.name}
                onToggle={() => onToggleFavorite(item.id)}
              />

              <button
                type="button"
                className={styles.rowIdentity}
                onClick={item.isRoot ? () => onOpenChooser(item.id) : () => onOpenWorkspace(item.rootId)}
              >
                <WorkspaceGlyph item={item} variant="list" />
                <span className={styles.rowCopy}>
                  <span className={styles.rowNameLine}>
                    <strong>{item.name}</strong>
                    {item.isRoot ? <RootBadge /> : null}
                  </span>
                  <span>{item.description}</span>
                </span>
              </button>

              <span className={styles.rowMeta}>
                <Icon name="users" size={17} />
                멤버&nbsp; {item.memberCount}명
              </span>

              <span className={styles.rowMeta}>
                <Icon name="orgChart" size={17} />
                하위 워크스페이스&nbsp; {item.childCount > 0 ? `${item.childCount}개` : '-'}
              </span>

              <span className={styles.rowDate}>
                <Icon name="calendar" size={17} />
                <span>
                  생성일
                  <time dateTime={item.createdAt}>{formatCreatedAt(item.createdAt)}</time>
                </span>
              </span>

              <MoreButton label={item.name} />
            </li>
          ))
        ) : (
          <li className={styles.listEmptyState}>이 페이지에 표시할 워크스페이스가 없습니다.</li>
        )}
      </ol>

      <footer className={styles.listFooter}>
        <span>총 {totalCount}개</span>
        <nav className={styles.pagination} aria-label="워크스페이스 목록 페이지">
          <button
            type="button"
            aria-label="이전 페이지"
            disabled={currentPage === 1}
            onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          >
            <Icon name="chevronLeft" size={17} />
          </button>
          {pageNumbers.map((page) => (
            <button
              type="button"
              key={page}
              className={currentPage === page ? styles.paginationActive : undefined}
              aria-current={currentPage === page ? 'page' : undefined}
              onClick={() => onPageChange(page)}
            >
              {page}
            </button>
          ))}
          <button
            type="button"
            aria-label="다음 페이지"
            disabled={currentPage === pageNumbers.length}
            onClick={() =>
              onPageChange(
                Math.min(pageNumbers.length, currentPage + 1),
              )
            }
          >
            <Icon name="chevronRight" size={17} />
          </button>
        </nav>
      </footer>
    </section>
  )
}

function WorkspaceChooserDialog({
  isOpen,
  rootOptions,
  selectedRootId,
  skipNextTime,
  onCancel,
  onConfirm,
  onSelectRoot,
  onSkipNextTimeChange,
}: {
  isOpen: boolean
  rootOptions: WorkspaceDirectoryItem[]
  selectedRootId: string
  skipNextTime: boolean
  onCancel: () => void
  onConfirm: () => void
  onSelectRoot: (id: string) => void
  onSkipNextTimeChange: (checked: boolean) => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const selectedRadioRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const appRoot = document.getElementById('root')
    const appRootWasInert = appRoot?.hasAttribute('inert') ?? false
    const previousOverflow = document.body.style.overflow
    const focusTimer = window.setTimeout(() => selectedRadioRef.current?.focus(), 0)

    document.body.style.overflow = 'hidden'
    appRoot?.setAttribute('inert', '')

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancel()
      }
    }

    document.addEventListener('keydown', handleDocumentKeyDown)

    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', handleDocumentKeyDown)
      document.body.style.overflow = previousOverflow
      if (!appRootWasInert) {
        appRoot?.removeAttribute('inert')
      }
      previouslyFocused?.focus()
    }
  }, [isOpen, onCancel])

  if (!isOpen) {
    return null
  }

  function handleDialogKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') {
      return
    }

    const focusableElements = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled):not([type="radio"]), input[type="radio"]:checked, a[href], [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    )

    if (focusableElements.length === 0) {
      return
    }

    const firstElement = focusableElements[0]
    const lastElement = focusableElements[focusableElements.length - 1]

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault()
      lastElement.focus()
    } else if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault()
      firstElement.focus()
    }
  }

  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div
      className={styles.dialogBackdrop}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) {
          onCancel()
        }
      }}
    >
      <div
        ref={dialogRef}
        className={styles.dialogPanel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="workspace-chooser-title"
        aria-describedby="workspace-chooser-description"
        onKeyDown={handleDialogKeyDown}
      >
        <header className={styles.dialogHeader}>
          <h2 id="workspace-chooser-title">진입할 최상위 워크스페이스를 선택하세요</h2>
          <p id="workspace-chooser-description">
            보려는 조직(최상위 워크스페이스)을 선택하면 해당 계층도로 이동합니다.
          </p>
        </header>

        <fieldset className={styles.rootOptions}>
          <legend className={styles.srOnly}>최상위 워크스페이스</legend>
          {rootOptions.map((root) => {
            const isSelected = root.id === selectedRootId

            return (
              <label
                className={[styles.rootOption, isSelected ? styles.rootOptionSelected : '']
                  .filter(Boolean)
                  .join(' ')}
                key={root.id}
              >
                <input
                  ref={isSelected ? selectedRadioRef : undefined}
                  type="radio"
                  name="workspace-root"
                  value={root.id}
                  checked={isSelected}
                  onChange={() => onSelectRoot(root.id)}
                />
                <WorkspaceGlyph item={root} variant="dialog" />
                <span className={styles.rootOptionCopy}>
                  <span className={styles.rootNameLine}>
                    <strong>{root.name}</strong>
                    <RootBadge />
                  </span>
                  <span>{root.description}</span>
                  <span>
                    멤버 {root.memberCount}명
                    <i aria-hidden="true" />
                    하위 {root.childCount}개
                  </span>
                </span>
                <span className={styles.radioMark} aria-hidden="true">
                  <i />
                </span>
              </label>
            )
          })}
        </fieldset>

        <footer className={styles.dialogFooter}>
          <label className={styles.skipChoice}>
            <input
              type="checkbox"
              checked={skipNextTime}
              onChange={(event) => onSkipNextTimeChange(event.target.checked)}
            />
            <span>
              다음부터 선택하지 않기
              <small>설정에서 변경할 수 있습니다.</small>
            </span>
          </label>
          <div className={styles.dialogActions}>
            <button type="button" className={styles.cancelButton} onClick={onCancel}>
              취소
            </button>
            <button type="button" className={styles.confirmButton} onClick={onConfirm}>
              확인
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  )
}

export function WorkspaceEntryPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const snapshot = getOrgSnapshot()
  const currentUser = getCurrentUser(snapshot)
  const workspaceDirectory = getWorkspaceDirectory(currentUser?.userId, snapshot)
  const activeRootId = getActiveWorkspaceRootId(currentUser?.userId)
  const defaultRootId = getDefaultWorkspaceRootId(currentUser?.userId)
  const activeRoot = workspaceDirectory.rootOptions.find((root) => root.id === activeRootId)
  const defaultRoot = workspaceDirectory.rootOptions.find((root) => root.id === defaultRootId)
  const hierarchyRoot =
    activeRoot ?? defaultRoot ?? workspaceDirectory.hierarchyRoot
  const shouldOpenChooserInitially = Boolean(
    hierarchyRoot && !activeRoot && !defaultRoot,
  )
  const view = searchParams.get('view') === 'list' ? 'list' : 'hierarchy'
  const [query, setQuery] = useState('')
  const [isHelpOpen, setIsHelpOpen] = useState(false)
  const [isChooserOpen, setIsChooserOpen] = useState(shouldOpenChooserInitially)
  const [selectedRootId, setSelectedRootId] = useState(
    () => hierarchyRoot?.id ?? workspaceDirectory.defaultRootId ?? '',
  )
  const [skipNextTime, setSkipNextTime] = useState(
    () => Boolean(defaultRoot && defaultRoot.id === hierarchyRoot?.id),
  )
  const [currentPage, setCurrentPage] = useState(1)
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(
    () =>
      new Set(
        workspaceDirectory.listItems
          .filter((item) => item.isFavorite)
          .map((item) => item.id),
      ),
  )
  const normalizedQuery = query.trim().toLocaleLowerCase('ko-KR')
  const hierarchyBranches = hierarchyRoot
    ? !normalizedQuery || matchesWorkspace(hierarchyRoot, normalizedQuery)
      ? hierarchyRoot.children
      : hierarchyRoot.children.flatMap((branch) => {
          if (matchesWorkspace(branch, normalizedQuery)) {
            return [branch]
          }

          const matchingChildren = branch.children.filter((child) =>
            matchesWorkspace(child, normalizedQuery),
          )
          return matchingChildren.length > 0 ? [{ ...branch, children: matchingChildren }] : []
        })
    : []
  const filteredListRows = workspaceDirectory.listItems.filter((item) =>
    matchesWorkspace(item, normalizedQuery),
  )
  const listPageCount = Math.max(1, Math.ceil(filteredListRows.length / WORKSPACE_LIST_PAGE_SIZE))
  const listPageNumbers = Array.from({ length: listPageCount }, (_, index) => index + 1)
  const listPageStart = (currentPage - 1) * WORKSPACE_LIST_PAGE_SIZE
  const visibleListRows = filteredListRows.slice(
    listPageStart,
    listPageStart + WORKSPACE_LIST_PAGE_SIZE,
  )

  function handleViewChange(nextView: 'hierarchy' | 'list') {
    const nextSearchParams = new URLSearchParams(searchParams)

    if (nextView === 'list') {
      nextSearchParams.set('view', 'list')
    } else {
      nextSearchParams.delete('view')
    }

    setCurrentPage(1)
    setSearchParams(nextSearchParams, { replace: true })
  }

  function handleQueryChange(nextQuery: string) {
    setQuery(nextQuery)
    setCurrentPage(1)
  }

  function toggleFavorite(id: string) {
    setFavoriteIds((currentIds) => {
      const nextIds = new Set(currentIds)

      if (nextIds.has(id)) {
        nextIds.delete(id)
      } else {
        nextIds.add(id)
      }

      return nextIds
    })
  }

  function handleConfirmWorkspace() {
    if (!workspaceDirectory.rootOptions.some((root) => root.id === selectedRootId)) {
      return
    }

    selectWorkspaceRoot(selectedRootId, skipNextTime, currentUser?.userId)
    navigate('/workspace')
  }

  const closeChooser = useCallback(() => {
    setIsChooserOpen(false)
  }, [])

  function openChooser(rootId = hierarchyRoot?.id ?? workspaceDirectory.defaultRootId ?? '') {
    if (!workspaceDirectory.rootOptions.some((root) => root.id === rootId)) {
      return
    }

    setSelectedRootId(rootId)
    setSkipNextTime(getDefaultWorkspaceRootId(currentUser?.userId) === rootId)
    setIsChooserOpen(true)
  }

  function openWorkspace(rootId: string) {
    if (!workspaceDirectory.rootOptions.some((root) => root.id === rootId)) {
      return
    }

    selectWorkspaceRoot(
      rootId,
      getDefaultWorkspaceRootId(currentUser?.userId) === rootId,
      currentUser?.userId,
    )
    navigate('/workspace')
  }

  return (
    <div className={styles.page}>
      <DirectoryToolbar
        query={query}
        isHelpOpen={isHelpOpen}
        onQueryChange={handleQueryChange}
        onToggleHelp={() => setIsHelpOpen((current) => !current)}
      />

      <header className={styles.pageIntro}>
        <div>
          <h1>
            {view === 'hierarchy' ? '워크스페이스 진입점 ' : '워크스페이스 '}
            <span>({view === 'hierarchy' ? '계층도' : '목록'})</span>
          </h1>
          <p>
            {view === 'hierarchy'
              ? '조직의 모든 워크스페이스를 계층 구조로 확인하고 이동할 수 있습니다.'
              : '조직의 모든 워크스페이스를 목록으로 확인하고 이동할 수 있습니다.'}
          </p>
        </div>
        <ViewToggle view={view} onChange={handleViewChange} />
      </header>

      {view === 'hierarchy' && hierarchyRoot ? (
        <HierarchyView
          root={hierarchyRoot}
          branches={hierarchyBranches}
          favoriteIds={favoriteIds}
          onOpenChooser={openChooser}
          onToggleFavorite={toggleFavorite}
        />
      ) : view === 'list' ? (
        <ListView
          rows={visibleListRows}
          favoriteIds={favoriteIds}
          currentPage={currentPage}
          pageNumbers={listPageNumbers}
          totalCount={filteredListRows.length}
          onOpenChooser={openChooser}
          onOpenWorkspace={openWorkspace}
          onPageChange={setCurrentPage}
          onToggleFavorite={toggleFavorite}
        />
      ) : (
        <section className={styles.emptyState} aria-live="polite">
          표시할 조직 워크스페이스가 없습니다.
        </section>
      )}

      <WorkspaceChooserDialog
        isOpen={isChooserOpen}
        rootOptions={workspaceDirectory.rootOptions}
        selectedRootId={selectedRootId}
        skipNextTime={skipNextTime}
        onCancel={closeChooser}
        onConfirm={handleConfirmWorkspace}
        onSelectRoot={setSelectedRootId}
        onSkipNextTimeChange={setSkipNextTime}
      />
    </div>
  )
}
