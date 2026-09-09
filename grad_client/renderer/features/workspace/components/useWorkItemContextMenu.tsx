import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { WorkItemFavoriteButton } from './WorkItemFavoriteButton'
import styles from './FileContextMenu.module.css'

export function useWorkItemContextMenu() {
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    ref.current?.querySelector('button')?.focus()
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
  const workItemContextMenu = menu ? createPortal(
    <div ref={ref} className={styles.menu} style={{ left: menu.x, top: menu.y }} role="menu" aria-label="업무 메뉴" onContextMenu={(event) => event.preventDefault()}>
      <WorkItemFavoriteButton workItemId={menu.id} menu onToggle={() => setMenu(null)} />
    </div>, document.body,
  ) : null
  return { onWorkItemContextMenu, workItemContextMenu }
}
