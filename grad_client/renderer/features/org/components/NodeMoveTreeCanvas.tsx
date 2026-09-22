import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../../design-system/primitives/Icon'
import { collectDescendantNodeIds, defaultCollapsedNodeIds, layoutNodeMoveTree, type MoveTreeNode } from '../../workspace/model/nodeMoveTree'
import type { WorkspaceDirectoryTone } from '../../workspace/model/workspaceDirectory'
import { getNodeVisualMetadata, getWorkspaceNodeDescription } from '../../workspace/queries/workspaceDirectory'
import entryStyles from '../../workspace/pages/WorkspaceEntryPage.module.css'
import styles from '../pages/NodeMovePage.module.css'

const toneClassNames: Record<WorkspaceDirectoryTone, string> = {
  indigo: entryStyles.toneIndigo,
  teal: entryStyles.toneTeal,
  blue: entryStyles.toneBlue,
  green: entryStyles.toneGreen,
  violet: entryStyles.toneViolet,
  orange: entryStyles.toneOrange,
  pink: entryStyles.tonePink,
}

const EMPTY_IDS: ReadonlySet<number> = new Set()

/** 워크스페이스 진입점 계층도 카드와 같은 글리프를 쓴다. */
function WorkspaceGlyph({ nodeType, variant }: { nodeType: MoveTreeNode['nodeType']; variant: 'root' | 'branch' | 'leaf' }) {
  const visual = getNodeVisualMetadata(nodeType)
  const variantSuffix = variant[0].toUpperCase() + variant.slice(1)
  return (
    <span
      className={[entryStyles.workspaceGlyph, entryStyles[`workspaceGlyph${variantSuffix}`], toneClassNames[visual.tone]].join(' ')}
      aria-hidden="true"
    >
      <Icon name={visual.iconName} size={variant === 'leaf' ? 26 : 30} />
    </span>
  )
}

export function NodeMoveTreeCanvas({ nodes, rootId, movingNodeId, movingIds, selectedId, eligibleIds, memberCounts, previewing, onSelect }: {
  nodes: MoveTreeNode[]; rootId: number; movingNodeId: number; movingIds: Set<number>
  selectedId: number | null | undefined; eligibleIds: Set<number>; memberCounts: ReadonlyMap<number, number>
  previewing: boolean; onSelect: (id: number) => void
}) {
  const [foldState, setFoldState] = useState<{ context: string; ids: Set<number> }>({ context: '', ids: new Set() })
  const foldContext = rootId + ':' + previewing
  const childCounts = useMemo(() => {
    const counts = new Map<number, number>()
    for (const node of nodes) if (node.parentNodeId !== undefined) counts.set(node.parentNodeId, (counts.get(node.parentNodeId) ?? 0) + 1)
    return counts
  }, [nodes])
  // 처음에는 탐색할 루트의 직계 하위만 펼치고, 이전할 워크스페이스는 현재 위치까지 내려가는 길과
  // 그 직계 하위만 펼쳐 둔다. 나머지는 모두 접힌 상태로 시작한다.
  const defaultCollapsedIds = useMemo(() => defaultCollapsedNodeIds(nodes, rootId, movingNodeId), [nodes, rootId, movingNodeId])
  const collapsedIds = useMemo(
    () => foldState.context === foldContext ? foldState.ids : defaultCollapsedIds,
    [foldState, foldContext, defaultCollapsedIds],
  )
  // 펼치기/접기는 진입점 계층도와 같은 애니메이션을 먼저 재생하고 나서 실제 접힘 상태를 바꾼다.
  const [foldAnimation, setFoldAnimation] = useState<{ context: string; expanding: Set<number>; collapsing: Set<number> }>(
    { context: '', expanding: new Set(), collapsing: new Set() },
  )
  const foldContextRef = useRef(foldContext)
  const collapseTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  const expandTimers = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  useEffect(() => {
    foldContextRef.current = foldContext
    const pendingCollapseTimers = collapseTimers.current
    const pendingExpandTimers = expandTimers.current
    return () => {
      pendingCollapseTimers.forEach((timer) => clearTimeout(timer))
      pendingExpandTimers.forEach((timer) => clearTimeout(timer))
      pendingCollapseTimers.clear()
      pendingExpandTimers.clear()
    }
  }, [foldContext])
  const expandingIds = foldAnimation.context === foldContext ? foldAnimation.expanding : EMPTY_IDS
  const collapsingIds = foldAnimation.context === foldContext ? foldAnimation.collapsing : EMPTY_IDS
  // 애니메이션은 접히거나 펼쳐지는 노드의 하위 카드에만 적용한다.
  const expandingCardIds = useMemo(() => collectDescendantNodeIds(nodes, expandingIds), [nodes, expandingIds])
  const collapsingCardIds = useMemo(() => collectDescendantNodeIds(nodes, collapsingIds), [nodes, collapsingIds])
  // 카드 깊이에 따라 진입점과 같은 단계별 카드 표기를 쓰기 위해 루트부터의 깊이를 계산한다.
  const depthById = useMemo(() => {
    const childIds = new Map<number, number[]>()
    for (const node of nodes) {
      if (node.parentNodeId === undefined) continue
      const siblings = childIds.get(node.parentNodeId) ?? []
      siblings.push(node.id)
      childIds.set(node.parentNodeId, siblings)
    }
    const depths = new Map<number, number>([[rootId, 0]])
    const queue = [rootId]
    while (queue.length) {
      const current = queue.shift() as number
      const depth = depths.get(current) ?? 0
      for (const childId of childIds.get(current) ?? []) {
        if (depths.has(childId)) continue
        depths.set(childId, depth + 1)
        queue.push(childId)
      }
    }
    return depths
  }, [nodes, rootId])
  function cancelCollapseTimer(id: number) {
    const timer = collapseTimers.current.get(id)
    if (timer === undefined) return
    clearTimeout(timer)
    collapseTimers.current.delete(id)
  }

  // 펼치기: 바로 펼치고 350ms 동안 확장 애니메이션만 재생한다.
  function expandNode(id: number, descendants: ReadonlySet<number>) {
    cancelCollapseTimer(id)
    descendants.forEach((descendant) => cancelCollapseTimer(descendant))
    setFoldState((prev) => {
      const ids = new Set(prev.context === foldContext ? prev.ids : collapsedIds)
      ids.delete(id)
      descendants.forEach((descendant) => ids.delete(descendant))
      return { context: foldContext, ids }
    })
    setFoldAnimation((prev) => ({
      context: foldContext,
      expanding: new Set(prev.context === foldContext ? prev.expanding : []).add(id),
      collapsing: prev.context === foldContext ? prev.collapsing : new Set(),
    }))
    const timer = setTimeout(() => {
      expandTimers.current.delete(id)
      if (foldContextRef.current !== foldContext) return
      setFoldAnimation((prev) => {
        if (prev.context !== foldContext) return prev
        const expanding = new Set(prev.expanding)
        expanding.delete(id)
        return { ...prev, expanding }
      })
    }, 350)
    expandTimers.current.set(id, timer)
  }

  // 접기: 160ms 동안 사라지는 애니메이션을 재생한 뒤 실제로 접는다.
  function collapseNode(id: number) {
    cancelCollapseTimer(id)
    setFoldAnimation((prev) => ({
      context: foldContext,
      collapsing: new Set(prev.context === foldContext ? prev.collapsing : []).add(id),
      expanding: prev.context === foldContext ? prev.expanding : new Set(),
    }))
    const timer = setTimeout(() => {
      collapseTimers.current.delete(id)
      if (foldContextRef.current !== foldContext) return
      setFoldState((prev) => {
        const ids = new Set(prev.context === foldContext ? prev.ids : collapsedIds)
        ids.add(id)
        return { context: foldContext, ids }
      })
      setFoldAnimation((prev) => {
        if (prev.context !== foldContext) return prev
        const collapsing = new Set(prev.collapsing)
        collapsing.delete(id)
        return { ...prev, collapsing }
      })
    }, 160)
    collapseTimers.current.set(id, timer)
  }

  function toggle(id: number) {
    if (collapsingIds.has(id)) return
    if (collapsedIds.has(id)) expandNode(id, EMPTY_IDS)
    else collapseNode(id)
  }

  // 우클릭 메뉴의 "하위 워크스페이스 모두 펼치기"는 자손 전체를 한 번에 펼친다.
  function expandSubtree(id: number) {
    expandNode(id, collectDescendantNodeIds(nodes, [id]))
  }

  const layout = useMemo(() => layoutNodeMoveTree(nodes, rootId, collapsedIds), [nodes, rootId, collapsedIds])
  const viewport = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointer: number; x: number; y: number; panX: number; panY: number; captured: boolean } | null>(null)
  const dragMoved = useRef(false)
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId: number } | null>(null)
  // 진입점 계층도처럼 클릭한 카드를 부드럽게 옮기기 위한 전환 상태.
  const [isTransitioning, setIsTransitioning] = useState(false)
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (transitionTimer.current) clearTimeout(transitionTimer.current) }, [])
  const layoutRef = useRef(layout)
  useEffect(() => { layoutRef.current = layout }, [layout])
  const fit = useCallback(() => {
    const element = viewport.current
    const { width, height } = layoutRef.current
    if (!element || !width) return
    const zoom = Math.min(1, Math.max(0.08, Math.min((element.clientWidth - 100) / width, (element.clientHeight - 100) / height)))
    setView({ zoom, x: (element.clientWidth - width * zoom) / 2, y: Math.max(50, (element.clientHeight - height * zoom) / 2) })
  }, [])
  // 화면 맞춤은 루트를 바꾸거나 뷰포트 크기가 달라질 때만 한다.
  // 펼치기/접기로 트리 크기가 바뀌어도 보고 있던 시야는 그대로 유지한다.
  useEffect(() => {
    fit()
    const element = viewport.current
    if (!element) return
    let lastWidth = element.clientWidth
    let lastHeight = element.clientHeight
    const observer = new ResizeObserver(() => {
      const current = viewport.current
      if (!current) return
      if (Math.abs(current.clientWidth - lastWidth) < 1 && Math.abs(current.clientHeight - lastHeight) < 1) return
      lastWidth = current.clientWidth
      lastHeight = current.clientHeight
      fit()
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [fit, rootId, previewing])
  // 우클릭 메뉴는 바깥을 클릭하면 닫는다.
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('resize', close)
    }
  }, [contextMenu])
  // 진입점 계층도와 같게, 카드를 가로 중앙 · 화면 위에서 140px 위치로 옮긴다.
  const centerCard = useCallback((element: HTMLElement) => {
    const vp = viewport.current
    if (!vp) return
    const vpRect = vp.getBoundingClientRect()
    const cardRect = element.getBoundingClientRect()
    const dx = vpRect.left + vpRect.width / 2 - (cardRect.left + cardRect.width / 2)
    const dy = vpRect.top + 140 - cardRect.top
    setIsTransitioning(true)
    setView((current) => ({ ...current, x: current.x + dx, y: current.y + dy }))
    if (transitionTimer.current) clearTimeout(transitionTimer.current)
    transitionTimer.current = setTimeout(() => setIsTransitioning(false), 350)
  }, [])

  const zoomAt = useCallback((factor: number, x: number, y: number) => {
    setView((current) => {
      const zoom = Math.max(0.08, Math.min(2, current.zoom * factor))
      const ratio = zoom / current.zoom
      return { zoom, x: x - (x - current.x) * ratio, y: y - (y - current.y) * ratio }
    })
  }, [])
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      if (event.ctrlKey || event.metaKey) {
        const rect = element.getBoundingClientRect()
        zoomAt(event.deltaY > 0 ? 0.9 : 1.1, event.clientX - rect.left, event.clientY - rect.top)
      } else setView((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }))
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [zoomAt])

  function zoom(factor: number) {
    const element = viewport.current
    if (element) zoomAt(factor, element.clientWidth / 2, element.clientHeight / 2)
  }

  const menuNode = contextMenu ? nodes.find((node) => node.id === contextMenu.nodeId) : undefined
  const menuChildCount = menuNode ? childCounts.get(menuNode.id) ?? 0 : 0
  const menuCollapsed = menuNode ? collapsedIds.has(menuNode.id) : false
  const menuEligible = menuNode ? eligibleIds.has(menuNode.id) && !previewing : false
  const menuReason = previewing ? '미리보기 중에는 목적지를 바꿀 수 없습니다.'
    : '현재 부모이거나 이전할 수 없는 공간입니다.'

  return <div className={[styles.canvas, dragging ? styles.dragging : ''].join(' ')} ref={viewport}
    aria-label={previewing ? '이전 후 워크스페이스 트리 미리보기' : '이전할 위치를 선택하는 워크스페이스 트리'}
    onContextMenu={() => setContextMenu(null)}
    onPointerDown={(event) => {
      dragMoved.current = false
      if (event.button !== 0 || (event.target as HTMLElement).closest('button')) return
      drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, panX: view.x, panY: view.y, captured: false }
      setDragging(true)
    }}
    onPointerMove={(event) => {
      const start = drag.current
      if (!start || start.pointer !== event.pointerId) return
      // 카드를 눌러도 클릭은 카드로 전달되어야 하므로, 실제로 끌기 시작한 뒤에만 포인터를 붙잡는다.
      if (!start.captured) {
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) <= 5) return
        start.captured = true
        dragMoved.current = true
        event.currentTarget.setPointerCapture(event.pointerId)
      }
      setView((current) => ({ ...current, x: start.panX + event.clientX - start.x, y: start.panY + event.clientY - start.y }))
    }}
    onPointerUp={() => { drag.current = null; setDragging(false) }}
    onPointerCancel={() => { drag.current = null; setDragging(false) }}
    onLostPointerCapture={() => { drag.current = null; setDragging(false) }}>
    <div className={styles.canvasTools}>
      <button type="button" onClick={() => zoom(1.2)} aria-label="트리 확대"><Icon name="plus" size={17} /></button>
      <span>{Math.round(view.zoom * 100)}%</span>
      <button type="button" onClick={() => zoom(1 / 1.2)} aria-label="트리 축소"><Icon name="minus" size={17} /></button>
      <button type="button" onClick={fit} aria-label="트리 전체 보기" title="전체 보기"><Icon name="maximize2" size={17} /></button>
    </div>
    <div className={[styles.graph, isTransitioning ? entryStyles.treeCanvasTransitioning : ''].filter(Boolean).join(' ')}
      style={{ width: layout.width, height: layout.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
      <svg width={layout.width} height={layout.height} className={styles.connectors} aria-hidden="true">
        {layout.edges.map((edge) => <path key={`${edge.parentId}-${edge.childId}`} d={edge.path}
          className={[
            movingIds.has(edge.childId) ? styles.movingEdge : '',
            collapsingCardIds.has(edge.childId) ? styles.subtreeCollapsing
              : expandingCardIds.has(edge.childId) ? styles.subtreeExpanding : '',
          ].filter(Boolean).join(' ')} />)}
      </svg>
      {layout.positions.map(({ node, x, y, width, height }) => {
        const moving = movingIds.has(node.id)
        const selected = selectedId === node.id
        const eligible = eligibleIds.has(node.id) && !previewing
        const unavailable = !moving && !selected && !eligible
        const deleted = Boolean(node.isDeleted)
        const isRoot = node.id === rootId
        const depth = depthById.get(node.id) ?? 0
        const childCount = childCounts.get(node.id) ?? 0
        const collapsed = collapsedIds.has(node.id)
        const memberCount = memberCounts.get(node.id) ?? 0
        const reason = deleted ? '삭제된 워크스페이스 · 이동하면 하위 경로도 함께 바뀝니다.'
          : moving ? '함께 이동할 워크스페이스'
            : unavailable ? '현재 부모이거나 하위 워크스페이스 생성 권한이 없는 공간입니다.' : '클릭하여 목적지로 선택'
        // 이동 대상 / 목적지는 이름 아래 배지 없이 카드 색으로만 구분한다.
        const stateClassName = moving ? styles.stateMoving : selected ? styles.stateDestination : ''
        const revealCard = (element: HTMLElement) => {
          // Keyboard navigation keeps off-screen cards visible without changing selection.
          if (!element.matches(':focus-visible') || !viewport.current) return
          const rect = element.getBoundingClientRect()
          const bounds = viewport.current.getBoundingClientRect()
          if (rect.left < bounds.left || rect.right > bounds.right || rect.top < bounds.top || rect.bottom > bounds.bottom) {
            setView((current) => ({ ...current, x: viewport.current!.clientWidth / 2 - (x + width / 2) * current.zoom,
              y: viewport.current!.clientHeight / 2 - (y + height / 2) * current.zoom }))
          }
        }
        const select = (element: HTMLElement) => {
          // 캔버스를 끌어 옮긴 뒤에는 클릭으로 처리하지 않는다.
          if (!dragMoved.current) centerCard(element)
          if (eligible) onSelect(node.id)
        }
        const openMenu = (event: React.MouseEvent) => {
          event.preventDefault()
          event.stopPropagation()
          setContextMenu({ x: event.clientX, y: event.clientY, nodeId: node.id })
        }
        const faceClassName = [
          styles.nodeCardFace,
          deleted && !moving && !selected ? entryStyles.dendroCardDeleted : unavailable ? entryStyles.dendroCardDisabled : '',
        ].filter(Boolean).join(' ')
        const animationClassName = collapsingCardIds.has(node.id) ? styles.subtreeCollapsing
          : expandingCardIds.has(node.id) ? styles.subtreeExpanding : ''
        return <div key={node.id} className={[styles.nodeCardFrame, stateClassName, animationClassName].filter(Boolean).join(' ')}
          style={{ left: x, top: y, width, height }}>
          {isRoot ? (
            <button type="button"
              className={[entryStyles.rootCard, faceClassName].join(' ')}
              aria-pressed={selected} aria-disabled={!eligible} title={reason}
              onClick={(event) => select(event.currentTarget)} onContextMenu={openMenu}
              onFocus={(event) => revealCard(event.currentTarget)}>
              <WorkspaceGlyph nodeType={node.nodeType} variant="root" />
              <span className={entryStyles.rootCardCopy}>
                <span className={entryStyles.rootNameLine}>
                  <strong>{node.name}</strong>
                  <span className={entryStyles.rootBadge}>루트</span>
                  {deleted ? <span className={entryStyles.deletedBadge}>삭제됨</span> : null}
                </span>
                <span>{getWorkspaceNodeDescription(node.nodeType, true)}</span>
                <span>{`직속 ${memberCount}명`}<i aria-hidden="true" />{`하위 ${childCount}개`}</span>
              </span>
              <Icon name={deleted ? 'trash' : unavailable ? 'lock' : 'chevronRight'} size={20} />
            </button>
          ) : (
            <div
              className={[
                entryStyles.dendroCard,
                depth === 1 ? entryStyles.dendroCardLevel1 : depth === 2 ? entryStyles.dendroCardLevel2 : entryStyles.dendroCardLevelDeep,
                faceClassName,
              ].join(' ')}
              role="button" tabIndex={0} title={reason}
              aria-pressed={selected} aria-disabled={!eligible}
              onClick={(event) => select(event.currentTarget)}
              onContextMenu={openMenu}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  select(event.currentTarget)
                }
              }}
              onFocus={(event) => revealCard(event.currentTarget)}>
              <div className={entryStyles.dendroGlyphWrapper}>
                <WorkspaceGlyph nodeType={node.nodeType} variant={depth === 1 ? 'branch' : 'leaf'} />
              </div>
              <div className={entryStyles.dendroCopy}>
                <strong className={entryStyles.dendroName}>{node.name}</strong>
                {deleted ? <span className={entryStyles.deletedBadge}>삭제됨</span> : null}
              </div>
              <div className={entryStyles.dendroFooter}>
                <small className={entryStyles.dendroMember}>{`직속 ${memberCount}명`}</small>
                {childCount > 0 ? (
                  <button type="button"
                    className={[entryStyles.dendroChildBadge, collapsed ? entryStyles.dendroChildBadgeCollapsed : ''].filter(Boolean).join(' ')}
                    aria-expanded={!collapsed}
                    aria-label={node.name + (collapsed ? ' 하위 워크스페이스 펼치기' : ' 하위 워크스페이스 접기')}
                    title={collapsed ? '하위 노드 펼치기' : '하위 노드 숨기기'}
                    onClick={(event) => { event.stopPropagation(); toggle(node.id) }}>
                    {collapsed ? `하위 +${childCount}개` : `하위 ${childCount}개`}
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </div>
      })}
    </div>
    {!layout.positions.length ? <p className={styles.empty}>표시할 워크스페이스가 없습니다.</p> : null}
    <div className={styles.canvasHint}>빈 공간 드래그로 이동 · Ctrl + 휠로 확대/축소 · 카드 우클릭으로 메뉴 열기</div>
    {contextMenu && menuNode ? <div className={entryStyles.contextMenu} style={{ top: contextMenu.y, left: contextMenu.x }}
      role="menu" onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation() }}>
      {menuChildCount > 0 ? <>
        <button type="button" role="menuitem" className={entryStyles.contextMenuItem}
          onClick={() => { const id = menuNode.id; setContextMenu(null); toggle(id) }}>
          <Icon name={menuCollapsed ? 'chevronDown' : 'chevronUp'} size={15} />
          <span>{menuCollapsed ? '하위 워크스페이스 펼치기' : '하위 워크스페이스 접기'}</span>
        </button>
        <button type="button" role="menuitem" className={entryStyles.contextMenuItem}
          onClick={() => { const id = menuNode.id; setContextMenu(null); expandSubtree(id) }}>
          <Icon name="maximize2" size={15} />
          <span>하위 워크스페이스 모두 펼치기</span>
        </button>
        <div className={entryStyles.contextMenuDivider} role="separator" />
      </> : null}
      <button type="button" role="menuitem"
        className={[entryStyles.contextMenuItem, menuEligible ? '' : entryStyles.contextMenuItemDisabled].filter(Boolean).join(' ')}
        title={menuEligible ? '이 워크스페이스를 이전할 위치로 지정합니다.' : menuReason}
        onClick={() => { const id = menuNode.id; setContextMenu(null); if (menuEligible) onSelect(id) }}>
        <Icon name={menuEligible ? 'orgChart' : 'lock'} size={15} />
        <span>이전할 위치로 지정</span>
      </button>
    </div> : null}
  </div>
}
