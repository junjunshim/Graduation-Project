import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '../../../design-system/primitives/Button'
import { Icon } from '../../../design-system/primitives/Icon'
import { Panel } from '../../../design-system/primitives/Panel'
import { getCurrentUser } from '../../auth/api'
import { WorkspaceEntryViewToggle } from '../components/WorkspaceEntryViewToggle'
import { getOrgSnapshot } from '../data/orgService'
import {
  getActiveWorkspaceRootId,
  getDefaultWorkspaceRootId,
  getFavoriteWorkspaceIds,
  selectWorkspaceRoot,
  toggleFavoriteWorkspaceId,
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

function formatMemberCount(item: WorkspaceDirectoryItem) {
  if (item.childCount > 0) {
    return `직속 ${item.directMemberCount}명 (전체 ${item.totalMemberCount}명)`
  }
  return `멤버 ${item.directMemberCount || item.memberCount}명`
}

function HierarchyView({
  root,
  branches,
  favoriteIds,
  onOpenWorkspace,
  onToggleFavorite,
}: {
  root: WorkspaceDirectoryItem
  branches: WorkspaceDirectoryItem[]
  favoriteIds: ReadonlySet<string>
  onOpenWorkspace: (rootId: string) => void
  onToggleFavorite: (id: string) => void
}) {
  return (
    <div className={styles.treeViewport}>
      <section className={styles.treeCanvas} aria-label={`${root.name} 워크스페이스 계층도`}>
        <div className={styles.rootCardWrapper}>
          <button type="button" className={styles.rootCard} onClick={() => onOpenWorkspace(root.id)}>
            <WorkspaceGlyph item={root} variant="root" />
            <span className={styles.rootCardCopy}>
              <span className={styles.rootNameLine}>
                <strong>{root.name}</strong>
                <RootBadge />
              </span>
              <span>{root.description}</span>
              <span>
                {formatMemberCount(root)}
                <i aria-hidden="true" />
                하위 {root.childCount}개
              </span>
            </span>
            <Icon name="chevronRight" size={20} />
          </button>
          <div className={styles.rootFavorite}>
            <FavoriteButton
              isFavorite={favoriteIds.has(root.id)}
              label={root.name}
              onToggle={() => onToggleFavorite(root.id)}
            />
          </div>
        </div>

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
                <article
                  className={styles.branchCard}
                  onClick={() => onOpenWorkspace(branch.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onOpenWorkspace(branch.id)
                    }
                  }}
                >
                  <div className={styles.branchFavorite} onClick={(e) => e.stopPropagation()}>
                    <FavoriteButton
                      isFavorite={favoriteIds.has(branch.id)}
                      label={branch.name}
                      onToggle={() => onToggleFavorite(branch.id)}
                    />
                  </div>
                  <div className={styles.branchMore} onClick={(e) => e.stopPropagation()}>
                    <MoreButton label={branch.name} />
                  </div>
                  <WorkspaceGlyph item={branch} variant="branch" />
                  <h2>{branch.name}</h2>
                  <p>{branch.description}</p>
                  <span>
                    {formatMemberCount(branch)}
                    <i aria-hidden="true" />
                    하위 {branch.childCount}개
                  </span>
                </article>

                {branch.children.length > 0 ? (
                  <ol className={styles.leafList}>
                    {branch.children.map((child) => (
                      <li
                        className={styles.leafCard}
                        key={child.id}
                        onClick={() => onOpenWorkspace(child.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            onOpenWorkspace(child.id)
                          }
                        }}
                      >
                        <div className={styles.leafFavorite} onClick={(e) => e.stopPropagation()}>
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
                          <small>{formatMemberCount(child)}</small>
                        </div>
                        <div onClick={(e) => e.stopPropagation()}>
                          <MoreButton label={child.name} />
                        </div>
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
  onOpenWorkspace,
  onPageChange,
  onToggleFavorite,
}: {
  rows: WorkspaceDirectoryItem[]
  favoriteIds: ReadonlySet<string>
  currentPage: number
  pageNumbers: number[]
  totalCount: number
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
                onClick={() => onOpenWorkspace(item.id)}
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
                {formatMemberCount(item)}
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
          <ol className={styles.pageList}>
            {pageNumbers.map((page) => (
              <li key={page}>
                <button
                  type="button"
                  className={currentPage === page ? styles.currentPageButton : undefined}
                  aria-current={currentPage === page ? 'page' : undefined}
                  onClick={() => onPageChange(page)}
                >
                  {page}
                </button>
              </li>
            ))}
          </ol>
          <button
            type="button"
            aria-label="다음 페이지"
            disabled={currentPage === pageNumbers.length}
            onClick={() => onPageChange(Math.min(pageNumbers.length, currentPage + 1))}
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
  onCancel,
  onConfirm,
  onSelectRoot,
}: {
  isOpen: boolean
  rootOptions: WorkspaceDirectoryItem[]
  selectedRootId: string
  onCancel: () => void
  onConfirm: () => void
  onSelectRoot: (id: string) => void
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
      <Panel
        ref={dialogRef}
        className={styles.dialogPanel}
        variant="dialog"
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
                    {formatMemberCount(root)}
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
          <div className={styles.dialogActions}>
            <Button variant="primary" className={styles.dialogButton} onClick={onConfirm}>
              확인
            </Button>
            <Button variant="secondary" className={styles.dialogButton} onClick={onCancel}>
              취소
            </Button>
          </div>
        </footer>
      </Panel>
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
  const [activeRootId, setActiveRootId] = useState(
    () => getActiveWorkspaceRootId(currentUser?.userId),
  )
  const defaultRootId = getDefaultWorkspaceRootId(currentUser?.userId)
  const activeRoot = workspaceDirectory.rootOptions.find((root) => root.id === activeRootId)
  const defaultRoot = workspaceDirectory.rootOptions.find((root) => root.id === defaultRootId)
  const hierarchyRoot =
    activeRoot ?? defaultRoot ?? workspaceDirectory.hierarchyRoot
  const shouldOpenChooserInitially = Boolean(
    hierarchyRoot && !activeRoot && !defaultRoot,
  )
  const view = searchParams.get('view') === 'list' ? 'list' : 'hierarchy'
  const [isChooserOpen, setIsChooserOpen] = useState(shouldOpenChooserInitially)
  const [selectedRootId, setSelectedRootId] = useState(
    () => hierarchyRoot?.id ?? workspaceDirectory.defaultRootId ?? '',
  )
  const [currentPage, setCurrentPage] = useState(1)
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(
    () => getFavoriteWorkspaceIds(currentUser?.userId),
  )

  const sortedRootOptions = [...workspaceDirectory.rootOptions].sort((a, b) => {
    const aFav = favoriteIds.has(a.id) ? 1 : 0
    const bFav = favoriteIds.has(b.id) ? 1 : 0
    return bFav - aFav
  })

  const hierarchyBranches = hierarchyRoot ? hierarchyRoot.children : []
  const scopedListItems = hierarchyRoot
    ? workspaceDirectory.listItems.filter(
        (item) => item.rootId === hierarchyRoot.id || item.id === hierarchyRoot.id,
      )
    : workspaceDirectory.listItems

  // 즐겨찾기된 워크스페이스가 목록의 맨 앞에 우선 배치되도록 정렬
  const filteredListRows = [...scopedListItems].sort((a, b) => {
    const aFav = favoriteIds.has(a.id) ? 1 : 0
    const bFav = favoriteIds.has(b.id) ? 1 : 0
    return bFav - aFav
  })

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

  function toggleFavorite(id: string) {
    const updated = toggleFavoriteWorkspaceId(id, currentUser?.userId)
    setFavoriteIds(new Set(updated))
  }

  function handleConfirmWorkspace() {
    if (!workspaceDirectory.rootOptions.some((root) => root.id === selectedRootId)) {
      return
    }

    selectWorkspaceRoot(selectedRootId, false, currentUser?.userId)
    setActiveRootId(selectedRootId)
    setIsChooserOpen(false)
  }

  const closeChooser = useCallback(() => {
    setIsChooserOpen(false)
  }, [])

  function openChooser(rootId = hierarchyRoot?.id ?? workspaceDirectory.defaultRootId ?? '') {
    if (!workspaceDirectory.rootOptions.some((root) => root.id === rootId)) {
      return
    }

    setSelectedRootId(rootId)
    setIsChooserOpen(true)
  }

  function openWorkspace(workspaceId: string) {
    const targetItem = workspaceDirectory.listItems.find((item) => item.id === workspaceId)
    if (!targetItem) {
      return
    }

    const targetRootId = targetItem.rootId || targetItem.id
    selectWorkspaceRoot(
      targetRootId,
      getDefaultWorkspaceRootId(currentUser?.userId) === targetRootId,
      currentUser?.userId,
    )
    navigate(`/workspace?nodeId=${encodeURIComponent(workspaceId)}`)
  }

  return (
    <div className={styles.page}>
      <WorkspaceEntryViewToggle
        view={view}
        onChange={handleViewChange}
        onOpenChooser={() => openChooser()}
      />

      {view === 'hierarchy' && hierarchyRoot ? (
        <HierarchyView
          root={hierarchyRoot}
          branches={hierarchyBranches}
          favoriteIds={favoriteIds}
          onOpenWorkspace={openWorkspace}
          onToggleFavorite={toggleFavorite}
        />
      ) : view === 'list' ? (
        <ListView
          rows={visibleListRows}
          favoriteIds={favoriteIds}
          currentPage={currentPage}
          pageNumbers={listPageNumbers}
          totalCount={filteredListRows.length}
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
        rootOptions={sortedRootOptions}
        selectedRootId={selectedRootId}
        onCancel={closeChooser}
        onConfirm={handleConfirmWorkspace}
        onSelectRoot={setSelectedRootId}
      />
    </div>
  )
}
