import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import { getOrgSnapshot } from '../data/orgService'
import { getCascadeWorkItemSummary } from '../data/cascadeWorkItemHelper'
import { WorkItemFavoriteButton } from './WorkItemFavoriteButton'
import { ConfirmDeleteModal } from './ConfirmDeleteModal'
import styles from './FileContextMenu.module.css'

export function useWorkItemContextMenu() {
  const navigate = useNavigate()
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{
    id: string
    title: string
    attachedFiles: Array<{ id: number; name: string; size?: number; workItemTitle?: string }>
    childWorkItems: Array<{ id: string; title: string }>
    childCount: number
  } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    ref.current?.querySelector('button')?.focus()
    const element = ref.current
    if (element) {
      const bounds = element.getBoundingClientRect()
      element.style.left = `${Math.max(8, Math.min(menu.x, window.innerWidth - bounds.width - 8))}px`
      element.style.top = `${Math.max(8, Math.min(menu.y, window.innerHeight - bounds.height - 8))}px`
    }
    const close = () => setMenu(null)
    const pointer = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) close() }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' || event.key === 'Tab') close() }
    window.addEventListener('pointerdown', pointer)
    window.addEventListener('keydown', key)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => { window.removeEventListener('pointerdown', pointer); window.removeEventListener('keydown', key); window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close) }
  }, [menu])
  function onWorkItemContextMenu(event: MouseEvent, targetWorkItemId?: string) {
    const id = targetWorkItemId || (event.target as Element).closest<HTMLElement>('[data-work-item-id]')?.dataset.workItemId
    if (!id) return
    event.preventDefault()
    event.stopPropagation()
    const width = 13 * parseFloat(getComputedStyle(document.documentElement).fontSize) + 16
    setMenu({ id, x: Math.max(8, Math.min(event.clientX, window.innerWidth - width)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 64)) })
  }
  function openPage(path: string) {
    setMenu(null)
    navigate(path)
  }
  function createChild(id: string) {
    const item = getOrgSnapshot().workItems.find((candidate) => candidate.workItemId === id)
    const params = new URLSearchParams({ parentWorkItemId: id })
    if (item) params.set('nodeId', String(item.ownerNodeId))
    openPage(`/work-items/new?${params}`)
  }
  const workItemContextMenu = (
    <>
      {menu
        ? createPortal(
            <div ref={ref} className={styles.menu} style={{ left: menu.x, top: menu.y }} role="menu" aria-label="업무 메뉴" onContextMenu={(event) => event.preventDefault()}>
              <button type="button" className={styles.item} role="menuitem" onClick={() => openPage(`/work-items/${menu.id}`)}>
                <Icon name="arrowRight" size={15} /><span>상세페이지 이동</span>
              </button>
              <button type="button" className={styles.item} role="menuitem" onClick={() => openPage(`/work-items/${menu.id}/edit`)}>
                <Icon name="pencil" size={15} /><span>업무 수정</span>
              </button>
              <button type="button" className={styles.item} role="menuitem" onClick={() => createChild(menu.id)}>
                <Icon name="plus" size={15} /><span>하위 업무 생성하기</span>
              </button>
              <WorkItemFavoriteButton workItemId={menu.id} menu onToggle={() => setMenu(null)} />
              <div className={styles.separator} />
              <button
                type="button"
                className={styles.deleteItem}
                role="menuitem"
                onClick={() => {
                  const snapshot = getOrgSnapshot()
                  const summary = getCascadeWorkItemSummary(
                    menu.id,
                    snapshot.workItems,
                    snapshot.files ?? [],
                    false,
                  )
                  const targetItem = snapshot.workItems.find((w) => w.workItemId === menu.id)
                  const attachedFiles = summary ? summary.allFiles : []
                  const childWorkItems = summary
                    ? summary.descendantWorkItems.map((c) => ({ id: c.workItemId, title: c.title }))
                    : []

                  setDeleteConfirmTarget({
                    id: menu.id,
                    title: targetItem?.title || menu.id,
                    attachedFiles,
                    childWorkItems,
                    childCount: childWorkItems.length,
                  })
                  setMenu(null)
                }}
              >
                <Icon name="trash" size={15} />
                <span>업무 삭제</span>
              </button>
            </div>,
            document.body,
          )
        : null}

      {deleteConfirmTarget && (
        <ConfirmDeleteModal
          isOpen={true}
          title="업무 삭제"
          itemName={deleteConfirmTarget.title}
          itemTypeLabel="업무"
          warningText="삭제된 업무는 휴지통으로 이동되며 15일간 보관 후 영구 삭제됩니다."
          attachedFiles={deleteConfirmTarget.attachedFiles}
          childWorkItems={deleteConfirmTarget.childWorkItems}
          childCount={deleteConfirmTarget.childCount}
          onClose={() => setDeleteConfirmTarget(null)}
          onConfirm={async () => {
            const target = deleteConfirmTarget
            try {
              const { deleteWorkItem } = await import('../data/workItemService')
              const { showToast } = await import('../../notification/data/toastEvents')
              const res = await deleteWorkItem(target.id)
              if (res.status === 'error') {
                showToast({
                  title: '업무 삭제 실패',
                  content: res.message || '업무를 삭제하지 못했습니다.',
                  created_at: new Date().toISOString(),
                })
              } else {
                showToast({
                  title: '업무 삭제 완료',
                  content: `'${target.title}' 업무가 삭제되어 휴지통으로 이동되었습니다.`,
                  created_at: new Date().toISOString(),
                })
              }
            } catch (error) {
              const { showToast } = await import('../../notification/data/toastEvents')
              showToast({
                title: '업무 삭제 실패',
                content: error instanceof Error ? error.message : '업무를 삭제하지 못했습니다.',
                created_at: new Date().toISOString(),
              })
            } finally {
              setDeleteConfirmTarget(null)
            }
          }}
        />
      )}
    </>
  )
  return { onWorkItemContextMenu, workItemContextMenu }
}
