import { useEffect, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import type { WorkItemFileRecord, WorkItemRecord } from '../model/types'
import { Icon } from '../../../design-system/primitives/Icon'
import { WorkItemFileUpload } from './WorkItemFileUpload'
import { WorkItemFileDownload } from './WorkItemFileDownload'
import { WorkItemFileDelete } from './WorkItemFileDelete'
import { ConfirmDeleteModal } from './ConfirmDeleteModal'
import styles from './FileContextMenu.module.css'

export function useFileContextMenu() {
  const [menu, setMenu] = useState<{
    file?: WorkItemFileRecord
    item?: WorkItemRecord
    onUploaded?: () => Promise<void>
    onDeleted?: () => Promise<void>
    onRestored?: () => Promise<void>
    x: number
    y: number
  } | null>(null)
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{
    file: WorkItemFileRecord
    onDeleted?: () => Promise<void>
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

  function openFileContextMenu(
    event: MouseEvent,
    file: WorkItemFileRecord,
    options?: {
      onDeleted?: () => Promise<void>
      onRestored?: () => Promise<void>
    } | (() => Promise<void>),
  ) {
    event.preventDefault()
    event.stopPropagation()
    const onDeleted = typeof options === 'function' ? options : options?.onDeleted
    const onRestored = typeof options === 'function' ? undefined : options?.onRestored

    const menuWidth = 13 * parseFloat(getComputedStyle(document.documentElement).fontSize) + 16
    setMenu({
      file,
      onDeleted,
      onRestored,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 96)),
    })
  }

  function openUploadContextMenu(event: MouseEvent, item: WorkItemRecord, onUploaded?: () => Promise<void>) {
    event.preventDefault()
    event.stopPropagation()
    const menuWidth = 13 * parseFloat(getComputedStyle(document.documentElement).fontSize) + 16
    setMenu({ item, onUploaded, x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 64)) })
  }

  const handleRestore = async (file: WorkItemFileRecord, callback?: () => Promise<void>) => {
    setMenu(null)
    try {
      const { restoreWorkItemFile } = await import('../data/fileService')
      const { showToast } = await import('../../notification/data/toastEvents')
      await restoreWorkItemFile(file.id)
      showToast({
        title: '파일 복구 완료',
        content: `'${file.originalFileName}' 파일이 복구되었습니다.`,
        created_at: new Date().toISOString(),
      })
      if (callback) {
        await callback()
      }
    } catch (error) {
      const { showToast } = await import('../../notification/data/toastEvents')
      showToast({
        title: '파일 복구 실패',
        content: error instanceof Error ? error.message : '파일을 복구하지 못했습니다.',
        created_at: new Date().toISOString(),
      })
    }
  }

  const fileContextMenu = (
    <>
      {menu
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label="파일 메뉴"
              className={styles.menu}
              style={{ left: menu.x, top: menu.y }}
              onContextMenu={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
            >
              {menu.file ? (
                menu.file.isDeleted ? (
                  <button
                    type="button"
                    role="menuitem"
                    className={[styles.menuItem, styles.restoreItem].join(' ')}
                    onClick={() => {
                      if (menu.file) {
                        void handleRestore(menu.file, menu.onRestored)
                      }
                    }}
                  >
                    <Icon name="rotateCcw" size={16} />
                    <span>파일 복구</span>
                  </button>
                ) : (
                  <>
                    <WorkItemFileDownload
                      key={`download-${menu.file.id}`}
                      file={menu.file}
                      onComplete={() => setMenu(null)}
                    />
                    <div className={styles.separator} />
                    <WorkItemFileDelete
                      key={`delete-${menu.file.id}`}
                      file={menu.file}
                      onRequestConfirm={() => {
                        if (menu.file) {
                          setDeleteConfirmTarget({
                            file: menu.file,
                            onDeleted: menu.onDeleted,
                          })
                        }
                        setMenu(null)
                      }}
                    />
                  </>
                )
              ) : null}
              {menu.item ? (
                <WorkItemFileUpload
                  key={menu.item.workItemId}
                  workItemId={menu.item.workItemId}
                  workItemTitle={menu.item.title}
                  onUploaded={menu.onUploaded}
                />
              ) : null}
            </div>,
            document.body,
          )
        : null}

      {deleteConfirmTarget && (
        <ConfirmDeleteModal
          isOpen={true}
          title="파일 삭제"
          itemName={deleteConfirmTarget.file.originalFileName}
          itemTypeLabel="파일"
          warningText="삭제된 파일은 휴지통으로 이동되며 15일간 보관 후 영구 삭제됩니다."
          onClose={() => setDeleteConfirmTarget(null)}
          onConfirm={async () => {
            const target = deleteConfirmTarget
            try {
              const { deleteWorkItemFile } = await import('../data/fileService')
              const { showToast } = await import('../../notification/data/toastEvents')
              await deleteWorkItemFile(target.file.id)
              showToast({
                title: '파일 삭제 완료',
                content: `'${target.file.originalFileName}' 파일이 삭제되어 휴지통으로 이동되었습니다.`,
                created_at: new Date().toISOString(),
              })
              if (target.onDeleted) {
                await target.onDeleted()
              }
            } catch (error) {
              const { showToast } = await import('../../notification/data/toastEvents')
              showToast({
                title: '파일 삭제 실패',
                content: error instanceof Error ? error.message : '파일을 삭제하지 못했습니다.',
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

  return { openFileContextMenu, openUploadContextMenu, fileContextMenu }
}
