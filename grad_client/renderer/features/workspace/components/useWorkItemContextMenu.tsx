import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import { getOrgSnapshot } from '../data/orgService'
import { WorkItemFavoriteButton } from './WorkItemFavoriteButton'
import styles from './FileContextMenu.module.css'

export function useWorkItemContextMenu() {
  const navigate = useNavigate()
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
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
  function onWorkItemContextMenu(event: MouseEvent) {
    const target = (event.target as Element).closest<HTMLElement>('[data-work-item-id]')
    const id = target?.dataset.workItemId
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
  const workItemContextMenu = menu ? createPortal(
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
    </div>, document.body,
  ) : null
  return { onWorkItemContextMenu, workItemContextMenu }
}
