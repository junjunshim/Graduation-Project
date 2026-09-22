import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../../../design-system/primitives/Button'
import { Icon } from '../../../design-system/primitives/Icon'
import type { MoveTransferTarget, NodeMovePreview } from '../../workspace/data/nodeMoveService'
import styles from '../pages/NodeMovePage.module.css'

export type NodeMoveTransfers = { transfers?: Record<string, string>; newOwnerEmail?: string }

function TargetSelect({ targets, value, onChange, disabled, label }: {
  targets: MoveTransferTarget[]; value: string; onChange: (value: string) => void; disabled: boolean; label: string
}) {
  return <select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled || !targets.length}>
    <option value="">{targets.length ? '새 담당자를 선택하세요' : '이관 가능한 담당자가 없습니다'}</option>
    {targets.map((target) => <option key={target.user_id} value={target.email}>{target.name} ({target.email})</option>)}
  </select>
}

export function NodeMoveConfirmDialog({ preview, workspaceName, destinationLabel, loading, busy, error, needsRefresh, onClose, onRefresh, onConfirm }: {
  preview: NodeMovePreview; workspaceName: string; destinationLabel: string
  loading: boolean; busy: boolean; error: string; needsRefresh: boolean
  onClose: () => void; onRefresh: () => void; onConfirm: (transfers: NodeMoveTransfers) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [mode, setMode] = useState<'each' | 'all'>('each')
  const [transfers, setTransfers] = useState<Record<string, string>>({})
  const [allTarget, setAllTarget] = useState('')
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])
  useEffect(() => { setTransfers({}); setAllTarget('') }, [preview.preview_token])
  const locked = loading || busy
  const complete = preview.owner_groups.length === 0 || (mode === 'all'
    ? preview.all_transfer_targets.some((target) => target.email === allTarget)
    : preview.owner_groups.every((group) => group.transfer_targets.some((target) => target.email === transfers[group.user_id])))

  return createPortal(<dialog ref={dialog} className={styles.dialog} aria-labelledby="move-confirm-title" aria-describedby="move-confirm-description"
    onCancel={(event) => { event.preventDefault(); if (!locked) onClose() }}
    onClick={(event) => {
      if (event.target !== event.currentTarget || locked) return
      const rect = event.currentTarget.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
    }}>
    <div className={styles.dialogHeader}>
      <div><span className={styles.eyebrow}>마지막 단계</span><h2 id="move-confirm-title">업무와 일정 변경 확인</h2>
        <p id="move-confirm-description">{workspaceName} → {destinationLabel}</p></div>
      <button type="button" className={styles.iconButton} aria-label="이관 확인 닫기" disabled={locked} onClick={onClose} autoFocus><Icon name="close" size={20} /></button>
    </div>
    <div className={styles.dialogBody} aria-busy={locked}>
      {loading ? <p className={styles.notice} role="status">최신 권한과 담당 업무를 다시 확인하고 있습니다…</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <div className={styles.summary}>
        <div><span>부모 업무 연결 해제</span><strong>{preview.detached_work_item_ids.length}<small>개 업무</small></strong></div>
        <div><span>담당자 이관</span><strong>{preview.owner_groups.reduce((sum, group) => sum + group.work_items.length, 0)}<small>개 업무</small></strong></div>
        <div><span>담당자 미정 전환</span><strong>{preview.cleared_schedules.length}<small>개 일정</small></strong></div>
      </div>
      <p className={styles.note}>기존 부모 공간의 업무에 연결된 업무는 최상위 업무로 변경됩니다. 완료 업무의 담당자는 유지됩니다.</p>
      {preview.owner_groups.length ? <>
        <fieldset className={styles.mode} disabled={locked}><legend>미완료 업무 이관 방식</legend>
          <label><input type="radio" name="transfer-mode" checked={mode === 'each'} onChange={() => setMode('each')} />담당자별로 지정</label>
          <label><input type="radio" name="transfer-mode" checked={mode === 'all'} onChange={() => setMode('all')} />한 사람에게 전체 이관</label>
        </fieldset>
        {mode === 'all' ? <TargetSelect targets={preview.all_transfer_targets} value={allTarget} onChange={setAllTarget} disabled={locked} label="전체 업무를 받을 담당자" /> : null}
        {mode === 'all' && !preview.all_transfer_targets.length ? <p className={styles.error}>모든 업무를 받을 수 있는 사용자가 없습니다. 담당자별로 지정하거나 필요한 권한을 먼저 부여해 주세요.</p> : null}
        {preview.owner_groups.map((group) => <section className={styles.ownerGroup} key={group.user_id}>
          <div className={styles.groupHeader}><div><strong>{group.name}</strong><small>{group.email} · {group.work_items.length}개 업무</small></div>
            {mode === 'each' ? <TargetSelect targets={group.transfer_targets} value={transfers[group.user_id] ?? ''}
              onChange={(email) => setTransfers((current) => ({ ...current, [group.user_id]: email }))}
              disabled={locked} label={`${group.name}의 업무를 받을 담당자`} /> : null}
          </div>
          {!group.transfer_targets.length ? <p className={styles.error}>이관 가능한 사용자가 없습니다. 해당 업무 공간에 담당자의 권한을 부여한 뒤 다시 확인해 주세요.</p> : null}
          <details><summary>이관할 업무 {group.work_items.length}개 보기</summary>
            <ul>{group.work_items.map((item) => <li key={item.work_item_id}>{item.title}<small> · {item.owner_node_name}</small></li>)}</ul>
          </details>
        </section>)}
      </> : <div className={styles.noTransfers}><Icon name="checkCircle" size={19} /><span>담당자 이관이 필요한 미완료 업무가 없습니다.</span></div>}
      {preview.cleared_schedules.length ? <details className={styles.scheduleDetails}><summary>담당자 미정으로 변경할 일정 {preview.cleared_schedules.length}개</summary>
        <ul>{preview.cleared_schedules.map((rule) => <li key={rule.rule_id}>{rule.title}</li>)}</ul>
        <p className={styles.note}>반복 설정은 유지됩니다. 새 담당자는 이전 후 지정할 수 있습니다.</p>
      </details> : null}
    </div>
    <footer className={styles.dialogFooter}>
      <Button variant="secondary" disabled={locked} onClick={onRefresh}>다시 확인</Button>
      <div><Button variant="secondary" disabled={locked} onClick={onClose}>트리로 돌아가기</Button>
        <Button variant="primary" disabled={locked || needsRefresh || !preview.can_move || !complete} onClick={() => onConfirm(
          mode === 'all' && preview.owner_groups.length ? { newOwnerEmail: allTarget } : { transfers },
        )}>{busy ? '이전 중…' : '확인 후 이전'}</Button></div>
    </footer>
  </dialog>, document.body)
}
