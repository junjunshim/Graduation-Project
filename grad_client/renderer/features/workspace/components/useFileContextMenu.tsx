import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import type { WorkItemFileRecord, WorkItemRecord } from '../model/types'
import { WorkItemFileUpload } from './WorkItemFileUpload'
import { WorkItemFileDownload } from './WorkItemFileDownload'
import styles from './FileContextMenu.module.css'

export function useFileContextMenu() {
  const [menu, setMenu] = useState<{
    file?: WorkItemFileRecord
    item?: WorkItemRecord
    onUploaded?: () => Promise<void>
    x: number
    y: number
  } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    menuRef.current?.querySelector('button')?.focus()
    const close = () => setMenu(null)
    const pointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) close()
    }
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' || event.key === 'Tab') close()
    }
    window.addEventListener('pointerdown', pointerDown)
    window.addEventListener('keydown', keyDown)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', pointerDown)
      window.removeEventListener('keydown', keyDown)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  function openFileContextMenu(event: MouseEvent, file: WorkItemFileRecord) {
    event.preventDefault()
    event.stopPropagation()
    const menuWidth = 13 * parseFloat(getComputedStyle(document.documentElement).fontSize) + 16
    setMenu({ file, x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 64)) })
  }

  function openUploadContextMenu(event: MouseEvent, item: WorkItemRecord, onUploaded?: () => Promise<void>) {
    event.preventDefault()
    event.stopPropagation()
    const menuWidth = 13 * parseFloat(getComputedStyle(document.documentElement).fontSize) + 16
    setMenu({ item, onUploaded, x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 64)) })
  }

  const fileContextMenu = menu ? createPortal(
    <div ref={menuRef} role="menu" aria-label="파일 메뉴"
      className={styles.menu} style={{ left: menu.x, top: menu.y }}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation() }}>
      {menu.file ? <WorkItemFileDownload key={menu.file.id} file={menu.file} onComplete={() => setMenu(null)} /> : null}
      {menu.item ? <WorkItemFileUpload key={menu.item.workItemId} workItemId={menu.item.workItemId} workItemTitle={menu.item.title} onUploaded={menu.onUploaded} /> : null}
    </div>, document.body,
  ) : null

  return { openFileContextMenu, openUploadContextMenu, fileContextMenu }
}
