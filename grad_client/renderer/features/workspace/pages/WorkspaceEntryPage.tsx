import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '../../../design-system/primitives/Button'
import { Icon } from '../../../design-system/primitives/Icon'
import { Panel } from '../../../design-system/primitives/Panel'
import { getCurrentUser } from '../../auth/api'
import { WorkspaceEntryViewToggle } from '../components/WorkspaceEntryViewToggle'
import { getOrgSnapshot, fetchWorkspaceDirectoryScope } from '../data/orgService'
import { subscribeToWorkspaceCache } from '../data/workspaceCacheEvents'
import {
  getActiveWorkspaceRootId,
  getDefaultWorkspaceRootId,
  getFavoriteWorkspaceIds,
  selectWorkspaceRoot,
  toggleFavoriteWorkspaceId,
} from '../data/workspaceDirectorySelection'
import type { WorkspaceDirectoryItem, WorkspaceDirectoryTone } from '../model/workspaceDirectory'
import { getWorkspaceDirectory } from '../queries/workspaceDirectory'
import { canCreateSubNode } from '../model/effectiveAuthority'
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
      <Icon name={item.iconName} size={variant === 'leaf' ? 26 : variant === 'dialog' ? 28 : 30} />
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

function MoreButton({
  label,
  onClick,
}: {
  label: string
  onClick?: (event: React.MouseEvent) => void
}) {
  return (
    <button
      type="button"
      className={styles.moreButton}
      title={`${label} 더보기`}
      aria-label={`${label} 추가 작업`}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.(e)
      }}
    >
      <Icon name="moreHorizontal" size={19} />
    </button>
  )
}

function formatMemberCount(item: WorkspaceDirectoryItem) {
  const direct = item.memberSummary?.directCount ?? item.directMemberCount
  const total = item.memberSummary?.totalCount ?? item.totalMemberCount

  if (total > 0 && total !== direct) {
    return `직속 ${direct}명 · 전체 ${total}명`
  }
  return `직속 ${direct}명`
}

function DendroBranchConnectors({
  childrenCount,
  containerRef,
  triggerKey,
}: {
  childrenCount: number
  containerRef: React.RefObject<HTMLDivElement>
  triggerKey?: string
}) {
  const [paths, setPaths] = useState<string[]>([])
  const svgHeight = 100

  useLayoutEffect(() => {
    function updateCurves() {
      const container = containerRef.current
      if (!container) return

      const containerRect = container.getBoundingClientRect()
      if (containerRect.width === 0) return

      // 부모 카드 요소 찾기 (바로 상위의 dendroSubTree 또는 dendroTopDownRoot)
      const parentSubTree = container.parentElement?.closest(`.${styles.dendroSubTree}, .${styles.dendroTopDownRoot}`)
      const parentCard = (parentSubTree?.querySelector(`:scope > .${styles.dendroNodeCardWrapper} > .${styles.dendroCard}`) ||
        parentSubTree?.querySelector(`:scope > .${styles.rootCardWrapper} > .${styles.rootCard}`)) as HTMLElement | null

      const childCols = Array.from(container.querySelectorAll(`:scope > .${styles.dendroChildCol}`)) as HTMLElement[]
      if (childCols.length === 0) return

      // 자식 카드들의 위치 추출
      const childCardCenters: number[] = []
      childCols.forEach((col) => {
        const childCard = (col.querySelector(`:scope > .${styles.dendroSubTree} > .${styles.dendroNodeCardWrapper} > .${styles.dendroCard}`) ||
          col.querySelector(`.${styles.dendroCard}`)) as HTMLElement | null
        
        let childX = col.offsetLeft + col.offsetWidth / 2
        if (childCard) {
          const childRect = childCard.getBoundingClientRect()
          const childCenterScreen = childRect.left + childRect.width / 2
          const relativeRatio = (childCenterScreen - containerRect.left) / containerRect.width
          childX = relativeRatio * container.offsetWidth
        }
        childCardCenters.push(childX)
      })

      // 부모 카드의 연결선 출발점 (X좌표):
      // 자식들이 1개 이상 있을 때 첫 번째 자식 중심과 마지막 자식 중심의 정중앙 또는 부모 카드의 화면 중심
      let parentX = container.offsetWidth / 2
      if (parentCard) {
        const parentRect = parentCard.getBoundingClientRect()
        const parentCenterScreen = parentRect.left + parentRect.width / 2
        const relativeRatio = (parentCenterScreen - containerRect.left) / containerRect.width
        parentX = relativeRatio * container.offsetWidth
      } else if (childCardCenters.length > 0) {
        parentX = (childCardCenters[0] + childCardCenters[childCardCenters.length - 1]) / 2
      }
      const parentY = 0

      const newPaths: string[] = []
      childCardCenters.forEach((childX) => {
        const childY = svgHeight
        // 부드러운 3차 베지에 곡선 (Cubic Bézier Spline Curve)
        const cp1Y = svgHeight * 0.5
        const cp2Y = svgHeight * 0.5
        const path = `M ${parentX} ${parentY} C ${parentX} ${cp1Y}, ${childX} ${cp2Y}, ${childX} ${childY}`
        newPaths.push(path)
      })

      setPaths(newPaths)
    }

    updateCurves()
    const startTime = performance.now()
    let animFrameId: number
    const animateCurves = (now: number) => {
      updateCurves()
      if (now - startTime < 450) {
        animFrameId = requestAnimationFrame(animateCurves)
      }
    }
    animFrameId = requestAnimationFrame(animateCurves)

    const containerEl = containerRef.current
    let resizeObserver: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined' && containerEl) {
      resizeObserver = new ResizeObserver(() => {
        updateCurves()
      })
      resizeObserver.observe(containerEl)
      const subTree = containerEl.closest(`.${styles.dendroSubTree}`) || containerEl.closest(`.${styles.dendroTopDownRoot}`)
      if (subTree) resizeObserver.observe(subTree)
    }

    window.addEventListener('resize', updateCurves)
    return () => {
      cancelAnimationFrame(animFrameId)
      if (resizeObserver) resizeObserver.disconnect()
      window.removeEventListener('resize', updateCurves)
    }
  }, [childrenCount, containerRef, triggerKey])

  if (childrenCount === 0) return null

  return (
    <svg className={styles.dendroSvgConnector} aria-hidden="true">
      {paths.map((d, index) => (
        <path
          key={index}
          className={styles.dendroSvgPath}
          d={d}
          fill="none"
          stroke="var(--axis-brand-border, #c8c7ff)"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      ))}
    </svg>
  )
}

function TreeNodeCard({
  item,
  depth,
  favoriteIds,
  collapsedIds,
  collapsingIds,
  expandingIds,
  onOpenWorkspace,
  onCardClick,
  onToggleFavorite,
  onToggleCollapse,
  onContextMenu,
}: {
  item: WorkspaceDirectoryItem
  depth: number
  favoriteIds: ReadonlySet<string>
  collapsedIds: ReadonlySet<string>
  collapsingIds?: ReadonlySet<string>
  expandingIds?: ReadonlySet<string>
  onOpenWorkspace: (id: string) => void
  onCardClick: (e: React.MouseEvent<HTMLElement>) => void
  onToggleFavorite: (id: string) => void
  onToggleCollapse: (id: string) => void
  onContextMenu: (event: React.MouseEvent, item: WorkspaceDirectoryItem) => void
}) {
  const hasChildren = item.children && item.children.length > 0
  const isFavorite = favoriteIds.has(item.id)
  const isCollapsed = collapsedIds.has(item.id)
  const isCollapsing = collapsingIds ? collapsingIds.has(item.id) : false
  const isExpanding = expandingIds ? expandingIds.has(item.id) : false
  const childrenRowRef = useRef<HTMLDivElement>(null)

  return (
    <div className={styles.dendroSubTree}>
      {/* 노드 카드 본체 (수직형 세로 카드) */}
      <div className={styles.dendroNodeCardWrapper}>
        <div
          className={[
            styles.dendroCard,
            depth === 1 ? styles.dendroCardLevel1 : depth === 2 ? styles.dendroCardLevel2 : styles.dendroCardLevelDeep,
            item.canEnter === false ? styles.dendroCardDisabled : '',
          ]
            .filter(Boolean)
            .join(' ')}
          onClick={onCardClick}
          onContextMenu={(e) => onContextMenu(e, item)}
          role="button"
          tabIndex={0}
          title={item.canEnter === false ? '상위 조상 식별용 노드로, 상세 진입 권한이 없습니다.' : undefined}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              onCardClick(e as unknown as React.MouseEvent<HTMLElement>)
            }
          }}
        >
          <div className={styles.dendroFavorite} onClick={(e) => e.stopPropagation()}>
            <FavoriteButton
              isFavorite={isFavorite}
              label={item.name}
              onToggle={() => onToggleFavorite(item.id)}
            />
          </div>

          <div className={styles.dendroGlyphWrapper}>
            <WorkspaceGlyph item={item} variant={depth === 1 ? 'branch' : 'leaf'} />
          </div>

          <div className={styles.dendroCopy}>
            <strong className={styles.dendroName} title={item.name}>{item.name}</strong>
          </div>

          <div className={styles.dendroFooter}>
            <small className={styles.dendroMember}>{formatMemberCount(item)}</small>
            {hasChildren && (
              <button
                type="button"
                className={[styles.dendroChildBadge, isCollapsed || isCollapsing ? styles.dendroChildBadgeCollapsed : ''].filter(Boolean).join(' ')}
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleCollapse(item.id)
                }}
                title={isCollapsed || isCollapsing ? '하위 노드 펼치기' : '하위 노드 숨기기'}
              >
                {isCollapsed || isCollapsing ? `하위 +${item.childCount}개` : `하위 ${item.childCount}개`}
              </button>
            )}
          </div>

          <div className={styles.dendroMore} onClick={(e) => e.stopPropagation()}>
            <MoreButton label={item.name} onClick={(e) => onContextMenu(e, item)} />
          </div>
        </div>
      </div>

      {/* 하위 자식 노드들 (Top-Down 수형 분기: 접히는 중 애니메이션 및 접기 완료 후 언마운트) */}
      {hasChildren && !isCollapsed && (() => {
        // 모든 하위 자식 노드들이 말단 노드(하위가 없는 노드)인지 판별
        const isLeafGroup = item.children.every((child) => !child.children || child.children.length === 0)

        return (
          <div
            className={[
              styles.dendroChildrenSection,
              isExpanding ? styles.dendroChildrenSectionExpanding : '',
              isCollapsing ? styles.dendroChildrenSectionCollapsing : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <div className={styles.dendroChildrenWrapper}>
              <div
                ref={childrenRowRef}
                className={[styles.dendroChildrenRow, isLeafGroup ? styles.dendroChildrenRowVertical : ''].filter(Boolean).join(' ')}
              >
                {isLeafGroup ? (
                  <div className={styles.dendroVerticalTopLine} aria-hidden="true" />
                ) : (
                  <DendroBranchConnectors
                    childrenCount={item.children.length}
                    containerRef={childrenRowRef}
                    triggerKey={`${item.id}-${isCollapsed}-${isCollapsing}`}
                  />
                )}
                {item.children.map((child) => (
                  <div key={child.id} className={styles.dendroChildCol}>
                    <TreeNodeCard
                      item={child}
                      depth={depth + 1}
                      favoriteIds={favoriteIds}
                      collapsedIds={collapsedIds}
                      collapsingIds={collapsingIds}
                      expandingIds={expandingIds}
                      onOpenWorkspace={onOpenWorkspace}
                      onCardClick={onCardClick}
                      onToggleFavorite={onToggleFavorite}
                      onToggleCollapse={onToggleCollapse}
                      onContextMenu={onContextMenu}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function HierarchyView({
  root,
  branches,
  favoriteIds,
  collapsedIds,
  collapsingIds,
  expandingIds,
  onOpenWorkspace,
  onToggleFavorite,
  onToggleCollapse,
  onContextMenu,
}: {
  root: WorkspaceDirectoryItem
  branches: WorkspaceDirectoryItem[]
  favoriteIds: ReadonlySet<string>
  collapsedIds: ReadonlySet<string>
  collapsingIds?: ReadonlySet<string>
  expandingIds?: ReadonlySet<string>
  onOpenWorkspace: (rootId: string) => void
  onToggleFavorite: (id: string) => void
  onToggleCollapse: (id: string) => void
  onContextMenu: (event: React.MouseEvent, item: WorkspaceDirectoryItem) => void
}) {
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const viewportRef = useRef<HTMLDivElement>(null)
  const rootBranchesRowRef = useRef<HTMLDivElement>(null)

  // 루트 워크스페이스 변경 시 줌/팬 초기화
  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [root.id])

  // 줌 인/아웃 핸들러 (최소 10% 축소 ~ 최대 250% 확대 지원)
  const handleZoomIn = () => setZoom((prev) => Math.min(2.5, Math.round((prev + 0.15) * 100) / 100))
  const handleZoomOut = () => setZoom((prev) => Math.max(0.1, Math.round((prev - 0.15) * 100) / 100))
  const handleResetZoom = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  // 캔버스 마우스 휠 동작: 브라우저/페이지의 기본 세로 스크롤을 원천 차단하고 줌(또는 팬) 처리
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault() // 뷰포트 내부에서 위아래 브라우저 스크롤 혼용 차단

      if (e.ctrlKey || e.metaKey) {
        const delta = e.deltaY > 0 ? -0.1 : 0.1
        setZoom((prev) => Math.min(2.5, Math.max(0.1, Math.round((prev + delta) * 100) / 100)))
      } else {
        // Ctrl을 누르지 않은 일반 마우스 휠 조작 시에도 위아래 팬(Pan)으로 자연스럽게 연동
        setPan((prev) => ({
          x: prev.x - e.deltaX,
          y: prev.y - e.deltaY,
        }))
      }
    }

    viewport.addEventListener('wheel', handleWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handleWheel)
  }, [])

  const canvasRef = useRef<HTMLElement>(null)

  // 캔버스 드래그 팬 (Pan)
  // 버튼, 인풋, 배지, 더보기 등의 대화형 요소 클릭 시에는 팬 시작을 제외하되,
  // 카드 자체를 누르고 드래그해도 정상적으로 캔버스를 끌 수 있도록 허용
  const isDraggingRef = useRef(false)
  const dragStartPosRef = useRef({ x: 0, y: 0 })

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return // 좌클릭만
    // 버튼, 인풋, 링크, 즐겨찾기, 더보기 버튼 등 클릭 시에는 팬 시작 안함
    if ((e.target as HTMLElement).closest(`button, input, a, .${styles.dendroFavorite}, .${styles.dendroMore}, .${styles.rootFavorite}`)) return

    setIsPanning(true)
    isDraggingRef.current = false
    dragStartPosRef.current = { x: e.clientX, y: e.clientY }
    panStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: pan.x,
      panY: pan.y,
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isPanning) return
    const dx = e.clientX - panStartRef.current.x
    const dy = e.clientY - panStartRef.current.y

    // 이동 거리가 5px를 넘으면 드래그 제스처로 확정
    if (Math.hypot(e.clientX - dragStartPosRef.current.x, e.clientY - dragStartPosRef.current.y) > 5) {
      isDraggingRef.current = true
    }

    setPan({
      x: panStartRef.current.panX + dx,
      y: panStartRef.current.panY + dy,
    })
  }

  const handleMouseUp = () => {
    setIsPanning(false)
  }

  const [isTransitioning, setIsTransitioning] = useState(false)
  const transitionTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current)
    }
  }, [])

  // 카드 좌클릭 시: 마우스를 잡고 캔버스를 끈(드래그) 경우에는 포커싱 취소, 순수한 클릭일 때만 상단 중앙으로 포커싱 이동
  const handleCardClick = (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation()

    // 드래그해서 캔버스를 움직인 경우 클릭 액션 방지
    if (isDraggingRef.current) {
      return
    }

    const cardEl = e.currentTarget
    const viewportEl = viewportRef.current
    if (!viewportEl) return

    const vpRect = viewportEl.getBoundingClientRect()
    const cardRect = cardEl.getBoundingClientRect()

    const cardCenterX = cardRect.left + cardRect.width / 2
    const cardTopY = cardRect.top
    const vpCenterX = vpRect.left + vpRect.width / 2
    // 상단 여백을 약 140px로 확보하여, 바로 위의 상위 부모 카드가 화면 상단에 걸쳐 보이도록 함 (상위 카드 즉시 클릭 가능)
    const targetTopY = vpRect.top + 140

    const dx = vpCenterX - cardCenterX
    const dy = targetTopY - cardTopY

    setIsTransitioning(true)
    setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }))

    if (transitionTimerRef.current) window.clearTimeout(transitionTimerRef.current)
    transitionTimerRef.current = window.setTimeout(() => {
      setIsTransitioning(false)
    }, 350)
  }

  return (
    <div
      ref={viewportRef}
      className={[styles.treeViewport, isPanning ? styles.treeViewportPanning : ''].filter(Boolean).join(' ')}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* 줌 / 팬 플로팅 툴바 */}
      <div className={styles.zoomToolbar} onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className={styles.zoomButton}
          onClick={handleZoomIn}
          title="확대 (Ctrl + 마우스 휠 위)"
          aria-label="확대"
        >
          <Icon name="plus" size={16} />
        </button>
        <button
          type="button"
          className={styles.zoomButton}
          onClick={handleZoomOut}
          title="축소 (Ctrl + 마우스 휠 아래)"
          aria-label="축소"
        >
          <Icon name="minus" size={16} />
        </button>
        <span className={styles.zoomDivider} />
        <button
          type="button"
          className={styles.zoomLabelButton}
          onClick={handleResetZoom}
          title="원래 크기로 초기화 (100%)"
        >
          {Math.round(zoom * 100)}%
        </button>
        <button
          type="button"
          className={styles.zoomButton}
          onClick={handleResetZoom}
          title="화면 맞춤 / 리셋"
          aria-label="리셋"
        >
          <Icon name="rotateCcw" size={15} />
        </button>
      </div>

      <section
        ref={canvasRef}
        className={[styles.treeCanvas, isTransitioning ? styles.treeCanvasTransitioning : ''].filter(Boolean).join(' ')}
        aria-label={`${root.name} 워크스페이스 계층도`}
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: 'top center',
        }}
      >
        <div className={styles.dendroTopDownRoot}>
          {/* 루트 노드 카드 */}
          <div className={styles.rootCardWrapper}>
            <button
              type="button"
              className={[
                styles.rootCard,
                root.canEnter === false ? styles.rootCardDisabled : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={handleCardClick}
              onContextMenu={(e) => onContextMenu(e, root)}
              title={root.canEnter === false ? '상위 조상 식별용 노드로, 상세 진입 권한이 없습니다.' : undefined}
            >
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
              <Icon name={root.canEnter === false ? 'lock' : 'chevronRight'} size={20} />
            </button>
            <div className={styles.rootFavorite}>
              <FavoriteButton
                isFavorite={favoriteIds.has(root.id)}
                label={root.name}
                onToggle={() => onToggleFavorite(root.id)}
              />
            </div>
          </div>

          {/* 1단계 브랜치 및 하위 수형 덴드로그램 트리 (접었을 때 부드러운 전환 후 레이아웃 재계산) */}
          {branches.length > 0 && !collapsedIds.has(root.id) && (
            <div
              className={[
                styles.dendroChildrenSection,
                expandingIds?.has(root.id) ? styles.dendroChildrenSectionExpanding : '',
                collapsingIds?.has(root.id) ? styles.dendroChildrenSectionCollapsing : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <div className={styles.dendroChildrenWrapper}>
                <div ref={rootBranchesRowRef} className={styles.dendroChildrenRow}>
                  <DendroBranchConnectors
                    childrenCount={branches.length}
                    containerRef={rootBranchesRowRef}
                    triggerKey={`${root.id}-${collapsedIds.has(root.id)}-${collapsingIds?.has(root.id)}`}
                  />
                  {branches.map((branch) => (
                    <div key={branch.id} className={styles.dendroChildCol}>
                      <TreeNodeCard
                        item={branch}
                        depth={1}
                        favoriteIds={favoriteIds}
                        collapsedIds={collapsedIds}
                        collapsingIds={collapsingIds}
                        expandingIds={expandingIds}
                        onOpenWorkspace={onOpenWorkspace}
                        onCardClick={handleCardClick}
                        onToggleFavorite={onToggleFavorite}
                        onToggleCollapse={onToggleCollapse}
                        onContextMenu={onContextMenu}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function ListView({
  rows,
  favoriteIds,
  currentPage,
  totalPages,
  totalCount,
  onOpenWorkspace,
  onPageChange,
  onToggleFavorite,
  onContextMenu,
}: {
  rows: WorkspaceDirectoryItem[]
  favoriteIds: ReadonlySet<string>
  currentPage: number
  totalPages: number
  totalCount: number
  onOpenWorkspace: (rootId: string) => void
  onPageChange: (page: number) => void
  onToggleFavorite: (id: string) => void
  onContextMenu: (event: React.MouseEvent, item: WorkspaceDirectoryItem) => void
}) {
  // 한 번에 최대 5개의 페이지 번호만 표시 (예: 1~5, 6~10, 11~15 ...)
  const PAGE_GROUP_SIZE = 5
  const currentGroup = Math.floor((currentPage - 1) / PAGE_GROUP_SIZE)
  const startPage = currentGroup * PAGE_GROUP_SIZE + 1
  const endPage = Math.min(startPage + PAGE_GROUP_SIZE - 1, totalPages)
  const visiblePages = Array.from({ length: endPage - startPage + 1 }, (_, i) => startPage + i)
  return (
    <section className={styles.listSection} aria-label="워크스페이스 목록">
      <ol className={styles.workspaceRows}>
        {rows.length > 0 ? (
          rows.map((item) => (
            <li
              className={styles.workspaceRow}
              key={item.id}
              onContextMenu={(e) => onContextMenu(e, item)}
            >
              <FavoriteButton
                isFavorite={favoriteIds.has(item.id)}
                label={item.name}
                onToggle={() => onToggleFavorite(item.id)}
              />

              <button
                type="button"
                className={[
                  styles.rowIdentity,
                  item.canEnter === false ? styles.rowIdentityDisabled : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={() => onOpenWorkspace(item.id)}
                title={item.canEnter === false ? '상위 조상 식별용 노드로, 상세 진입 권한이 없습니다.' : undefined}
              >
                <WorkspaceGlyph item={item} variant="list" />
                <span className={styles.rowCopy}>
                  <span className={styles.rowNameLine}>
                    <strong>{item.name}</strong>
                    {item.isRoot ? <RootBadge /> : null}
                    {item.canEnter === false ? (
                      <span title="상위 노드 식별 전용 (진입 불가)" style={{ display: 'inline-flex', alignItems: 'center', opacity: 0.65 }}>
                        <Icon name="lock" size={14} />
                      </span>
                    ) : null}
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

              <div className={styles.rowMoreWrapper} onClick={(e) => e.stopPropagation()}>
                <MoreButton
                  label={item.name}
                  onClick={(e) => onContextMenu(e, item)}
                />
              </div>
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
            {visiblePages.map((page) => (
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
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
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
  const [snapshot, setSnapshot] = useState(() => getOrgSnapshot())
  const currentUser = getCurrentUser(snapshot)
  const workspaceDirectory = getWorkspaceDirectory(currentUser?.userId, snapshot)
  const paramRootId = searchParams.get('rootId')
  const [activeRootId, setActiveRootId] = useState(
    () => paramRootId || getActiveWorkspaceRootId(currentUser?.userId),
  )
  const defaultRootId = getDefaultWorkspaceRootId(currentUser?.userId)
  const activeRoot = workspaceDirectory.rootOptions.find((root) => root.id === (paramRootId || activeRootId))
  const defaultRoot = workspaceDirectory.rootOptions.find((root) => root.id === defaultRootId)
  const hierarchyRoot =
    activeRoot ?? defaultRoot ?? workspaceDirectory.hierarchyRoot
  const shouldOpenChooserInitially = Boolean(
    !paramRootId && hierarchyRoot && !activeRoot && !defaultRoot,
  )
  const view = searchParams.get('view') === 'list' ? 'list' : 'hierarchy'
  const [isChooserOpen, setIsChooserOpen] = useState(shouldOpenChooserInitially)
  const [selectedRootId, setSelectedRootId] = useState(
    () => paramRootId || hierarchyRoot?.id || workspaceDirectory.defaultRootId || '',
  )
  const [currentPage, setCurrentPage] = useState(1)
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(
    () => getFavoriteWorkspaceIds(currentUser?.userId),
  )
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const toastTimerRef = useRef<number | null>(null)

  const showToast = (message: string) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current)
    setToastMessage(message)
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null)
    }, 2800)
  }

  useEffect(() => {
    let isMounted = true

    // 진입점 화면 진입 시: 캐시로 즉시 띄우되, 백그라운드에서 최신 스코프(트리/역할)를 경량 동기화하여 삭제/권한 박탈된 노드 자동 갱신
    fetchWorkspaceDirectoryScope()
      .then((latestSnapshot) => {
        if (isMounted) {
          setSnapshot(latestSnapshot)
        }
      })
      .catch((err) => {
        console.warn('[WorkspaceEntryPage] 워크스페이스 스코프 갱신 실패:', err)
      })

    const unsubscribe = subscribeToWorkspaceCache(() => {
      if (isMounted) {
        setSnapshot(getOrgSnapshot())
      }
    })

    return () => {
      isMounted = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (paramRootId) {
      setActiveRootId(paramRootId)
      setSelectedRootId(paramRootId)
      setIsChooserOpen(false)
    }
  }, [paramRootId])

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

  useEffect(() => {
    const updateFavorites = () => setFavoriteIds(getFavoriteWorkspaceIds(currentUser?.userId))
    window.addEventListener('grad-client-favorites-updated', updateFavorites)
    window.addEventListener('storage', updateFavorites)
    return () => {
      window.removeEventListener('grad-client-favorites-updated', updateFavorites)
      window.removeEventListener('storage', updateFavorites)
    }
  }, [currentUser?.userId])

  function toggleFavorite(id: string) {
    const updated = toggleFavoriteWorkspaceId(id, currentUser?.userId)
    setFavoriteIds(new Set(updated))
  }

  // 자식을 가진 모든 노드들을 기본적으로 접힌 상태(collapsed)로 관리하는 헬퍼 함수
  // 부모를 펼쳤을 때 직속 하위 업무만 나타나고, 그 아래의 깊은 하위 업무들은 접힌 상태를 유지하도록 함
  function collectAllCollapsibleIds(items: WorkspaceDirectoryItem[]): Set<string> {
    const ids = new Set<string>()
    function traverse(list: WorkspaceDirectoryItem[]) {
      for (const item of list) {
        if (item.children && item.children.length > 0) {
          ids.add(item.id)
          traverse(item.children)
        }
      }
    }
    traverse(items)
    return ids
  }

  // 하위 노드가 있는 모든 브랜치/하위 노드들을 초기에 접힌 상태(collapsed)로 설정하여
  // 하위 노드가 있는 모든 브랜치/하위 노드들을 초기에 접힌 상태(collapsed)로 설정하여
  // 직속 하위 업무만 단계별로 펼쳐볼 수 있도록 함
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() =>
    collectAllCollapsibleIds(hierarchyBranches)
  )
  const [collapsingIds, setCollapsingIds] = useState<Set<string>>(new Set())
  const [expandingIds, setExpandingIds] = useState<Set<string>>(new Set())

  // 루트 워크스페이스 변경 시 새 루트의 모든 하위 브랜치 노드들도 기본 접힘 처리
  useEffect(() => {
    if (hierarchyBranches.length > 0) {
      setCollapsedIds(collectAllCollapsibleIds(hierarchyBranches))
    }
  }, [hierarchyRoot?.id])

  function toggleCollapse(id: string) {
    if (collapsedIds.has(id)) {
      // 펼치기: 즉시 collapsedIds에서 제거하고, 350ms 동안만 expandingIds에 넣어 애니메이션을 실행한 뒤 제거
      // (애니메이션 완료 후 GPU 합성 레이어에서 해제되어 축소 시 블러 방지)
      setCollapsedIds((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      setExpandingIds((prev) => new Set(prev).add(id))
      setTimeout(() => {
        setExpandingIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }, 350)
    } else {
      // 접기: 먼저 collapsingIds에 추가하여 페이드아웃 애니메이션을 실행하고 160ms 후 collapsedIds에 추가
      setCollapsingIds((prev) => new Set(prev).add(id))
      setTimeout(() => {
        setCollapsedIds((prev) => new Set(prev).add(id))
        setCollapsingIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }, 160)
    }
  }

  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    item: WorkspaceDirectoryItem
    canCreateSub: boolean
  } | null>(null)

  // 외부 클릭 시 컨텍스트 메뉴 닫기
  useEffect(() => {
    const handleClose = () => setContextMenu(null)
    if (contextMenu) {
      window.addEventListener('click', handleClose)
      window.addEventListener('contextmenu', handleClose)
    }
    return () => {
      window.removeEventListener('click', handleClose)
      window.removeEventListener('contextmenu', handleClose)
    }
  }, [contextMenu])

  const handleContextMenu = (e: React.MouseEvent, item: WorkspaceDirectoryItem) => {
    e.preventDefault()
    e.stopPropagation()

    const parsedNodeId = parseInt(item.id, 10)
    const canCreateSub =
      Number.isFinite(parsedNodeId) && currentUser
        ? canCreateSubNode(currentUser.userId, parsedNodeId, snapshot)
        : false

    // 권한이 있는 경우 컨텍스트 메뉴 표시 (화면 벗어남 방지)
    const menuWidth = 220
    const menuHeight = 150
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 10)
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 10)

    setContextMenu({
      x,
      y,
      item,
      canCreateSub,
    })
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

    if (targetItem.canEnter === false) {
      showToast('상위 조상 식별용 노드로, 상세 워크스페이스 진입 권한이 없습니다.')
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
    <div className={[styles.page, view === 'hierarchy' ? styles.pageHierarchy : ''].filter(Boolean).join(' ')}>
      <WorkspaceEntryViewToggle
        view={view}
        onChange={handleViewChange}
        onOpenChooser={() => openChooser()}
      />

      {view === 'hierarchy' && hierarchyRoot ? (
        <HierarchyView
          key={hierarchyRoot.id}
          root={hierarchyRoot}
          branches={hierarchyBranches}
          favoriteIds={favoriteIds}
          collapsedIds={collapsedIds}
          collapsingIds={collapsingIds}
          expandingIds={expandingIds}
          onOpenWorkspace={openWorkspace}
          onToggleFavorite={toggleFavorite}
          onToggleCollapse={toggleCollapse}
          onContextMenu={handleContextMenu}
        />
      ) : view === 'list' ? (
        <ListView
          rows={visibleListRows}
          favoriteIds={favoriteIds}
          currentPage={currentPage}
          totalPages={listPageCount}
          totalCount={filteredListRows.length}
          onOpenWorkspace={openWorkspace}
          onPageChange={setCurrentPage}
          onToggleFavorite={toggleFavorite}
          onContextMenu={handleContextMenu}
        />
      ) : (
        <section className={styles.emptyState} aria-live="polite">
          표시할 조직 워크스페이스가 없습니다.
        </section>
      )}

      {/* 우클릭 / 더보기 컨텍스트 메뉴 */}
      {contextMenu ? (
        <div
          className={styles.contextMenu}
          style={{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className={[
              styles.contextMenuItem,
              contextMenu.item.canEnter === false ? styles.contextMenuItemDisabled : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => {
              const item = contextMenu.item
              setContextMenu(null)
              if (item.canEnter === false) {
                showToast('상위 조상 식별용 노드로, 상세 워크스페이스 진입 권한이 없습니다.')
                return
              }
              openWorkspace(item.id)
            }}
            title={contextMenu.item.canEnter === false ? '상위 조상 식별용 노드로, 상세 진입 권한이 없습니다.' : undefined}
          >
            <Icon name={contextMenu.item.canEnter === false ? 'lock' : 'folder'} size={15} />
            <span>{contextMenu.item.canEnter === false ? '워크스페이스 열기 (권한 없음)' : '워크스페이스 열기'}</span>
          </button>

          {/* 하위 노드가 있는 경우: 숨기기 / 펼치기 메뉴 */}
          {contextMenu.item.children && contextMenu.item.children.length > 0 ? (
            <button
              type="button"
              className={styles.contextMenuItem}
              onClick={() => {
                const item = contextMenu.item
                setContextMenu(null)
                toggleCollapse(item.id)
              }}
            >
              <Icon name={collapsedIds.has(contextMenu.item.id) ? 'chevronDown' : 'chevronUp'} size={15} />
              <span>{collapsedIds.has(contextMenu.item.id) ? '하위 노드 펼치기' : '하위 노드 숨기기'}</span>
            </button>
          ) : null}

          {contextMenu.canCreateSub ? (
            <button
              type="button"
              className={styles.contextMenuItem}
              onClick={() => {
                const item = contextMenu.item
                setContextMenu(null)
                navigate(`/setup/sub-node?parentNodeId=${encodeURIComponent(item.id)}`)
              }}
            >
              <Icon name="plus" size={15} />
              <span>하위 워크스페이스 생성</span>
            </button>
          ) : null}

          <div className={styles.contextMenuDivider} />

          <button
            type="button"
            className={styles.contextMenuItem}
            onClick={() => {
              const item = contextMenu.item
              setContextMenu(null)
              toggleFavorite(item.id)
            }}
          >
            <Icon name="star" size={15} />
            <span>{favoriteIds.has(contextMenu.item.id) ? '즐겨찾기 해제' : '즐겨찾기 추가'}</span>
          </button>
        </div>
      ) : null}

      <WorkspaceChooserDialog
        isOpen={isChooserOpen}
        rootOptions={sortedRootOptions}
        selectedRootId={selectedRootId}
        onCancel={closeChooser}
        onConfirm={handleConfirmWorkspace}
        onSelectRoot={setSelectedRootId}
      />

      {toastMessage ? (
        <aside className={styles.entryToast} role="status" aria-live="polite">
          <Icon name="alertTriangle" size={18} className={styles.entryToastIcon} />
          <span>{toastMessage}</span>
        </aside>
      ) : null}
    </div>
  )
}
