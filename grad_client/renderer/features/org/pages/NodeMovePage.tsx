import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button } from '../../../design-system/primitives/Button'
import { Icon } from '../../../design-system/primitives/Icon'
import { getCurrentUser } from '../../auth/api'
import { fetchWorkspaceDirectoryScope, getNodePathLabel, getOrgSnapshot } from '../../workspace/data/orgService'
import { fetchNodeMovePreview, moveNode, type NodeMovePreview } from '../../workspace/data/nodeMoveService'
import { selectWorkspaceRoot } from '../../workspace/data/workspaceDirectorySelection'
import { canCreateSubNode, hasDirectAuthorityBit } from '../../workspace/model/effectiveAuthority'
import { findDeletedAncestorNode } from '../../workspace/model/nodeDeletion'
import { projectNodeMoveTree } from '../../workspace/model/nodeMoveTree'
import { NodeMoveTreeCanvas } from '../components/NodeMoveTreeCanvas'
import { NodeMoveConfirmDialog, type NodeMoveTransfers } from '../components/NodeMoveConfirmDialog'
import styles from './NodeMovePage.module.css'

export function NodeMovePage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const nodeId = Number(params.get('nodeId'))
  const userId = getCurrentUser()?.userId ?? ''
  const [snapshot, setSnapshot] = useState(getOrgSnapshot)
  const [sourceNodes, setSourceNodes] = useState<NodeMovePreview['nodes']>([])
  const [viewRootId, setViewRootId] = useState<number>()
  // undefined: nothing selected; null: detach as a root; number: destination parent.
  const [selectedParentId, setSelectedParentId] = useState<number | null>()
  const [preview, setPreview] = useState<NodeMovePreview | null>(null)
  const [ready, setReady] = useState(false)
  const [checking, setChecking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [pageError, setPageError] = useState('')
  const [reviewError, setReviewError] = useState('')
  const [needsRefresh, setNeedsRefresh] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [revision, setRevision] = useState(0)
  const operation = useRef(0)
  const node = snapshot.nodes.find((candidate) => candidate.id === nodeId)
  const sourceRootId = node?.path[0] ?? nodeId
  const locked = !ready || checking || busy

  useEffect(() => {
    let active = true
    operation.current += 1
    setReady(false)
    setPreview(null)
    setSourceNodes([])
    setDialogOpen(false)
    setSelectedParentId(undefined)
    setPageError('')
    setChecking(false)
    async function initialize() {
      try {
        const next = await fetchWorkspaceDirectoryScope()
        if (!active) return
        setSnapshot(next)
        const source = next.nodes.find((candidate) => candidate.id === nodeId)
        if (!source || source.nodeType === 'USER' || !hasDirectAuthorityBit(userId, nodeId, 12, next)) {
          throw new Error('이 워크스페이스에 직접 부여된 수정 권한이 필요합니다.')
        }
        setViewRootId(source.path[0] ?? nodeId)
        // Also fetch descendants outside the directory's visible scope, without writing.
        const initial = await fetchNodeMovePreview(nodeId, null)
        if (!active) return
        setSourceNodes(initial.nodes)
        setReady(true)
      } catch (cause) {
        if (active) setPageError(cause instanceof Error ? cause.message : '워크스페이스를 불러오지 못했습니다.')
      }
    }
    void initialize()
    return () => { active = false; operation.current += 1 }
  }, [nodeId, userId, revision])

  const movingIds = useMemo(() => new Set(sourceNodes.length ? sourceNodes.map((item) => item.node_id)
    : snapshot.nodes.filter((item) => item.path.includes(nodeId)).map((item) => item.id)), [sourceNodes, snapshot.nodes, nodeId])
  const eligibleIds = useMemo(() => new Set(snapshot.nodes.filter((candidate) =>
    candidate.nodeType !== 'USER' && !candidate.path.includes(nodeId) && candidate.id !== node?.parentNodeId
    && !findDeletedAncestorNode(candidate.id, snapshot.nodes) && canCreateSubNode(userId, candidate.id, snapshot),
  ).map((candidate) => candidate.id)), [snapshot, nodeId, node?.parentNodeId, userId])
  const treeNodes = useMemo(() => projectNodeMoveTree(
    snapshot.nodes.filter((candidate) => candidate.nodeType !== 'USER'
      && (movingIds.has(candidate.id) || !findDeletedAncestorNode(candidate.id, snapshot.nodes))),
    preview?.nodes ?? sourceNodes, Boolean(preview),
  ), [snapshot.nodes, movingIds, preview, sourceNodes])
  const rootOptions = useMemo(() => snapshot.nodes.filter((candidate) => candidate.nodeType !== 'USER'
    && candidate.parentNodeId === undefined && !candidate.isDeleted).sort((a, b) => a.name.localeCompare(b.name)), [snapshot.nodes])
  // 진입점 카드와 같은 표기를 쓰기 위해 직속 담당자 수를 진입점과 같은 기준으로 센다.
  const memberCounts = useMemo(() => {
    const counts = new Map<number, number>()
    snapshot.roles.forEach((role) => {
      if (!role.isDeleted) counts.set(role.nodeId, (counts.get(role.nodeId) ?? 0) + 1)
    })
    return counts
  }, [snapshot.roles])
  const destinationLabel = selectedParentId === null ? '독립된 루트 워크스페이스'
    : selectedParentId !== undefined ? getNodePathLabel(selectedParentId, snapshot.nodes) : '트리에서 목적지를 선택하세요'
  const activeRootId = preview?.nodes.find((item) => item.node_id === nodeId)?.new_path[0] ?? viewRootId ?? sourceRootId
  const movedCount = movingIds.size

  function chooseRoot(rootId: number) {
    setViewRootId(rootId)
    setSelectedParentId(undefined)
    setPreview(null)
    setPageError('')
  }
  function chooseParent(parentId: number) {
    if (locked || preview || !eligibleIds.has(parentId)) return
    setSelectedParentId(parentId)
    setPageError('')
  }

  async function inspectDestination(parentId: number | null, review: boolean) {
    if (checking || busy) return
    const request = ++operation.current
    setChecking(true)
    if (review) { setDialogOpen(true); setReviewError(''); setNeedsRefresh(true) }
    else setPageError('')
    try {
      const next = await fetchNodeMovePreview(nodeId, parentId)
      if (request !== operation.current) return
      setSelectedParentId(parentId)
      setPreview(next)
      setSourceNodes(next.nodes)
      setNeedsRefresh(false)
    } catch (cause) {
      if (request !== operation.current) return
      const message = cause instanceof Error ? cause.message : '이전 영향을 확인하지 못했습니다.'
      if (review) setReviewError(message)
      else setPageError(message)
    } finally { if (request === operation.current) setChecking(false) }
  }

  async function submit(transfers: NodeMoveTransfers) {
    if (!preview || preview.node_id !== nodeId || preview.parent_node_id !== selectedParentId
      || busy || checking || needsRefresh || !preview.can_move) return
    const request = ++operation.current
    setBusy(true)
    setReviewError('')
    try {
      await moveNode({ nodeId, parentNodeId: preview.parent_node_id, previewToken: preview.preview_token, ...transfers })
      if (request !== operation.current) return
      selectWorkspaceRoot(String(activeRootId), false, userId)
      navigate('/workspace/select?rootId=' + activeRootId)
    } catch (cause) {
      if (request !== operation.current) return
      setReviewError(cause instanceof Error ? cause.message : '워크스페이스를 이전하지 못했습니다.')
      setNeedsRefresh(true)
    } finally { if (request === operation.current) setBusy(false) }
  }

  return <div className={styles.page} aria-busy={checking || busy}>
    <div className={styles.headerBar}>
      <div className={styles.headerLeft}>
        <div className={styles.sourceChip}><span className={styles.sourceDot} /><strong>{node?.name ?? '워크스페이스'}</strong><span>외 하위 {Math.max(0, movedCount - 1)}개 함께 이동</span></div>
        <ol className={styles.steps} aria-label="이전 순서"><li aria-current={!preview ? 'step' : undefined}>1 위치 선택</li><li aria-current={preview ? 'step' : undefined}>2 트리 미리보기</li><li>3 이관 확인</li></ol>
      </div>
      <div className={styles.headerRight}>
        <div className={styles.rootControl}><Icon name="orgChart" size={15} />
          <label htmlFor="move-root">탐색할 루트</label>
          <select id="move-root" value={preview ? activeRootId : viewRootId ?? sourceRootId} disabled={locked || Boolean(preview)} onChange={(event) => chooseRoot(Number(event.target.value))}>
            {preview && !rootOptions.some((root) => root.id === activeRootId) ? <option value={activeRootId}>{node?.name} (새 루트)</option> : null}
            {rootOptions.map((root) => <option key={root.id} value={root.id}>{root.name}</option>)}
          </select>
        </div>
        <div className={styles.viewToggle} role="group" aria-label="보기 전환">
          <button type="button" aria-pressed={!preview && activeRootId === sourceRootId} disabled={locked}
            title="이전할 워크스페이스가 있는 트리를 봅니다." onClick={() => chooseRoot(sourceRootId)}>이동 대상 보기</button>
          <button type="button" aria-pressed={selectedParentId === null} disabled={locked || node?.parentNodeId === undefined}
            title="이전할 위치를 독립된 루트 워크스페이스로 정합니다." onClick={() => void inspectDestination(null, false)}>루트 워크스페이스로 전환</button>
        </div>
      </div>
    </div>
    {pageError ? <div className={styles.error} role="alert">{pageError}{!ready ? <Button variant="secondary" onClick={() => setRevision((value) => value + 1)}>다시 불러오기</Button> : null}</div> : null}
    <div className={styles.treeArea}>
      {ready ? <NodeMoveTreeCanvas nodes={treeNodes} rootId={activeRootId} movingNodeId={nodeId} movingIds={movingIds}
        selectedId={selectedParentId} eligibleIds={eligibleIds} memberCounts={memberCounts}
        previewing={Boolean(preview)} onSelect={chooseParent} />
        : <div className={styles.loading} role="status">{pageError ? '워크스페이스 정보를 확인해 주세요.' : '워크스페이스 트리를 불러오고 있습니다…'}</div>}
      {preview ? <div className={styles.previewBanner}><Icon name="checkCircle" size={18} /><span><strong>이전 후 트리 미리보기</strong> · 아직 이전되지 않았습니다.</span></div> : null}
      <div className={styles.legend}><span><i className={styles.sourceDot} />함께 이동</span><span><i className={styles.targetDot} />선택한 목적지</span></div>
    </div>
    <footer className={styles.footer}>
      <div className={styles.selection}><strong title={preview ? '이전할 위치' : '선택한 목적지'}>{destinationLabel}</strong></div>
      <div className={styles.footerActions}>
        <Button variant="secondary" disabled={busy || checking} onClick={() => navigate('/workspace/select')}>취소</Button>
        {preview ? <>
          <Button variant="secondary" disabled={locked} onClick={() => { setViewRootId(activeRootId === nodeId ? sourceRootId : activeRootId); setPreview(null); setPageError('') }}>위치 다시 선택</Button>
          <Button variant="primary" disabled={locked} onClick={() => void inspectDestination(preview.parent_node_id, true)}>업무·일정 변경 확인<Icon name="chevronRight" size={16} /></Button>
        </> : <Button variant="primary" disabled={locked || selectedParentId === undefined} onClick={() => {
          if (selectedParentId !== undefined) void inspectDestination(selectedParentId, false)
        }}>{checking ? '확인 중…' : '해당 위치로 이전'}<Icon name="chevronRight" size={16} /></Button>}
      </div>
    </footer>
    {dialogOpen && preview ? <NodeMoveConfirmDialog preview={preview} workspaceName={node?.name ?? '워크스페이스'} destinationLabel={destinationLabel}
      loading={checking} busy={busy} error={reviewError} needsRefresh={needsRefresh}
      onClose={() => { if (!checking && !busy) setDialogOpen(false) }}
      onRefresh={() => void inspectDestination(preview.parent_node_id, true)} onConfirm={(transfers) => void submit(transfers)} /> : null}
  </div>
}

