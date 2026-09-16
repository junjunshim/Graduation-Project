import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import type { WorkItemFileRecord, WorkItemRecord } from '../model/types'
import type { RecurringRuleFileRecord, RecurringRuleRecord } from '../model/recurringRuleTypes'
import { Icon } from '../../../design-system/primitives/Icon'
import { WorkItemFileUpload } from './WorkItemFileUpload'
import { WorkItemFileDownload } from './WorkItemFileDownload'
import { WorkItemFileDelete } from './WorkItemFileDelete'
import { ConfirmDeleteModal } from './ConfirmDeleteModal'
import { downloadRecurringRuleFile, deleteRecurringRuleFile, readCachedRecurringRules, restoreRecurringRuleFile, uploadRecurringRuleFile } from '../data/recurringRuleService'
import { showToast } from '../../notification/data/toastEvents'
import { getCurrentUser } from '../../auth/api'
import { getOrgSnapshot } from '../data/orgService'
import {
  canChangeRecurringRuleFile,
  canChangeWorkItemFile,
  canDownloadRecurringRuleFile,
  canDownloadWorkItemFile,
  canUploadRecurringRuleFile,
  canUploadWorkItemFile,
} from '../model/filePermission'
import styles from './FileContextMenu.module.css'

export type UnifiedFileRecord =
  | (WorkItemFileRecord & { fileType?: 'work_item' })
  | (RecurringRuleFileRecord & { fileType: 'recurring_rule'; id: number; workItemId?: string; uploaderName?: string })

export type UnifiedFolderTarget =
  | { type: 'work_item'; item: WorkItemRecord }
  | { type: 'recurring_rule'; rule: RecurringRuleRecord }

export function useFileContextMenu() {
  const [menu, setMenu] = useState<{
    file?: UnifiedFileRecord
    item?: WorkItemRecord
    recurringRule?: RecurringRuleRecord
    onUploaded?: () => Promise<void>
    onDeleted?: () => Promise<void>
    onRestored?: () => Promise<void>
    x: number
    y: number
  } | null>(null)
  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<{
    file: UnifiedFileRecord
    canChange: boolean
    onDeleted?: () => Promise<void>
  } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const [isUploadingRecurring, setIsUploadingRecurring] = useState(false)

  // 메뉴가 가리키는 대상에 대해 서버(DB 함수)와 동일한 기준으로 권한을 계산한다.
  // 권한이 없으면 메뉴 항목을 비활성화해 실패할 요청을 미리 막는다.
  const permissions = useMemo(() => {
    const denied = { canDownload: false, canChange: false, canUpload: false }
    if (!menu) return denied

    const snapshot = getOrgSnapshot()
    const userId = getCurrentUser(snapshot)?.userId ?? null
    if (!userId) return denied

    if (menu.file) {
      const file = menu.file

      if (file.fileType === 'recurring_rule') {
        const rule = readCachedRecurringRules().find((candidate) => candidate.ruleId === file.ruleId) ?? null
        if (!rule) return denied

        return {
          ...denied,
          canDownload: canDownloadRecurringRuleFile(userId, rule, snapshot),
          canChange: canChangeRecurringRuleFile(userId, file, rule, snapshot),
        }
      }

      const item = snapshot.workItems.find((candidate) => candidate.workItemId === file.workItemId) ?? null
      if (!item) return denied

      return {
        ...denied,
        canDownload: canDownloadWorkItemFile(userId, item, snapshot),
        canChange: canChangeWorkItemFile(userId, file, item, snapshot),
      }
    }

    if (menu.item) {
      return { ...denied, canUpload: canUploadWorkItemFile(userId, menu.item, snapshot) }
    }

    if (menu.recurringRule) {
      return { ...denied, canUpload: canUploadRecurringRuleFile(userId, menu.recurringRule, snapshot) }
    }

    return denied
  }, [menu])

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
    file: UnifiedFileRecord | WorkItemFileRecord,
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
      file: file as UnifiedFileRecord,
      onDeleted,
      onRestored,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 96)),
    })
  }

  function openUploadContextMenu(
    event: MouseEvent,
    target: WorkItemRecord | UnifiedFolderTarget,
    onUploaded?: () => Promise<void>,
  ) {
    event.preventDefault()
    event.stopPropagation()
    const menuWidth = 13 * parseFloat(getComputedStyle(document.documentElement).fontSize) + 16

    if ('type' in target) {
      if (target.type === 'recurring_rule') {
        setMenu({
          recurringRule: target.rule,
          onUploaded,
          x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth)),
          y: Math.max(8, Math.min(event.clientY, window.innerHeight - 64)),
        })
        return
      }
      setMenu({
        item: target.item,
        onUploaded,
        x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth)),
        y: Math.max(8, Math.min(event.clientY, window.innerHeight - 64)),
      })
      return
    }

    setMenu({
      item: target,
      onUploaded,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 64)),
    })
  }

  const handleRestore = async (file: UnifiedFileRecord, callback?: () => Promise<void>) => {
    setMenu(null)

    if (!permissions.canChange) {
      showToast({
        title: '파일 복구 실패',
        content: '파일을 복구할 권한이 없습니다.',
        created_at: new Date().toISOString(),
      })
      return
    }

    try {
      if (file.fileType === 'recurring_rule') {
        const fileId = file.fileId ?? file.id
        const res = await restoreRecurringRuleFile(fileId)
        if (res.status === 'error') {
          throw new Error(res.message || '일정 파일 복구에 실패했습니다.')
        }
      } else {
        const { restoreWorkItemFile } = await import('../data/fileService')
        await restoreWorkItemFile(file.id)
      }

      showToast({
        title: '파일 복구 완료',
        content: `'${file.originalFileName}' 파일이 복구되었습니다.`,
        created_at: new Date().toISOString(),
      })
      if (callback) {
        await callback()
      }
    } catch (error) {
      showToast({
        title: '파일 복구 실패',
        content: error instanceof Error ? error.message : '파일을 복구하지 못했습니다.',
        created_at: new Date().toISOString(),
      })
    }
  }

  const handleDownloadUnifiedFile = async (file: UnifiedFileRecord) => {
    setMenu(null)

    if (!permissions.canDownload) {
      showToast({
        title: '파일 다운로드 실패',
        content: '파일을 다운로드할 권한이 없습니다.',
        created_at: new Date().toISOString(),
      })
      return
    }

    try {
      if (file.fileType === 'recurring_rule') {
        const fileId = file.fileId ?? file.id
        await downloadRecurringRuleFile(fileId, file.originalFileName)
      } else {
        const { downloadWorkItemFile } = await import('../data/fileService')
        await downloadWorkItemFile(file.id, file.originalFileName)
      }
      showToast({
        title: '파일 다운로드 완료',
        content: `'${file.originalFileName}' 파일을 다운로드했습니다.`,
        created_at: new Date().toISOString(),
      })
    } catch (err) {
      showToast({
        title: '파일 다운로드 실패',
        content: `${file.originalFileName}: ${err instanceof Error ? err.message : '다운로드 중 오류가 발생했습니다.'}`,
        created_at: new Date().toISOString(),
      })
    }
  }

  const handleRecurringFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = event.target.files?.[0]
    event.target.value = ''
    if (!uploadedFile || !menu?.recurringRule) return

    if (!permissions.canUpload) {
      showToast({
        title: '파일 등록 실패',
        content: '파일을 등록할 권한이 없습니다.',
        created_at: new Date().toISOString(),
      })
      return
    }

    setIsUploadingRecurring(true)
    const rule = menu.recurringRule
    const callback = menu.onUploaded
    setMenu(null)

    try {
      const res = await uploadRecurringRuleFile(rule.ruleId, uploadedFile)
      if (res.status === 'success') {
        showToast({
          title: '파일 등록 완료',
          content: `'${rule.title}' 일정에 '${uploadedFile.name}' 파일이 등록되었습니다.`,
          created_at: new Date().toISOString(),
        })
        if (callback) await callback()
      } else {
        showToast({
          title: '파일 등록 실패',
          content: res.message || '파일을 등록하지 못했습니다.',
          created_at: new Date().toISOString(),
        })
      }
    } catch (err) {
      showToast({
        title: '파일 등록 실패',
        content: err instanceof Error ? err.message : '파일을 등록하지 못했습니다.',
        created_at: new Date().toISOString(),
      })
    } finally {
      setIsUploadingRecurring(false)
    }
  }

  const fileContextMenu = (
    <>
      <input
        ref={uploadInputRef}
        type="file"
        hidden
        onChange={handleRecurringFileUpload}
        disabled={isUploadingRecurring}
      />

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
                    className={[styles.menuItem, styles.restoreItem, permissions.canChange ? '' : styles.permissionDenied].join(' ')}
                    disabled={!permissions.canChange}
                    title={permissions.canChange ? '파일 복구' : '파일을 복구할 권한이 없습니다.'}
                    onClick={() => {
                      if (menu.file) {
                        void handleRestore(menu.file, menu.onRestored)
                      }
                    }}
                  >
                    <Icon name="rotateCcw" size={16} />
                    <span>파일 복구</span>
                  </button>
                ) : menu.file.fileType === 'recurring_rule' ? (
                  <>
                    <button
                      type="button"
                      className={[styles.item, permissions.canDownload ? '' : styles.permissionDenied].join(' ')}
                      role="menuitem"
                      disabled={!permissions.canDownload}
                      title={permissions.canDownload ? '다운로드' : '파일 다운로드 권한이 없습니다.'}
                      onClick={() => {
                        if (menu.file) void handleDownloadUnifiedFile(menu.file)
                      }}
                    >
                      <Icon name="chevronDown" size={15} />
                      <span>다운로드</span>
                    </button>
                    <div className={styles.separator} />
                    <button
                      type="button"
                      className={[styles.deleteItem, permissions.canChange ? '' : styles.permissionDenied].join(' ')}
                      role="menuitem"
                      disabled={!permissions.canChange}
                      title={permissions.canChange ? '삭제' : '파일을 변경할 권한이 없습니다.'}
                      onClick={() => {
                        if (menu.file) {
                          setDeleteConfirmTarget({
                            file: menu.file,
                            canChange: permissions.canChange,
                            onDeleted: menu.onDeleted,
                          })
                        }
                        setMenu(null)
                      }}
                    >
                      <Icon name="trash" size={15} />
                      <span>삭제</span>
                    </button>
                  </>
                ) : (
                  <>
                    <WorkItemFileDownload
                      key={`download-${menu.file.id}`}
                      file={menu.file as WorkItemFileRecord}
                      disabled={!permissions.canDownload}
                      disabledReason="파일 다운로드 권한이 없습니다."
                      onComplete={() => setMenu(null)}
                    />
                    <div className={styles.separator} />
                    <WorkItemFileDelete
                      key={`delete-${menu.file.id}`}
                      file={menu.file as WorkItemFileRecord}
                      disabled={!permissions.canChange}
                      disabledReason="파일을 변경할 권한이 없습니다."
                      onRequestConfirm={() => {
                        if (menu.file) {
                          setDeleteConfirmTarget({
                            file: menu.file,
                            canChange: permissions.canChange,
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
                  disabled={!permissions.canUpload}
                  disabledReason="파일을 등록할 권한이 없습니다."
                />
              ) : null}
              {menu.recurringRule ? (
                <button
                  type="button"
                  role="menuitem"
                  className={[styles.item, permissions.canUpload ? '' : styles.permissionDenied].join(' ')}
                  disabled={isUploadingRecurring || !permissions.canUpload}
                  title={permissions.canUpload ? '양식 파일 등록' : '파일을 등록할 권한이 없습니다.'}
                  onClick={() => uploadInputRef.current?.click()}
                >
                  <Icon name="plus" size={15} />
                  <span>{isUploadingRecurring ? '등록 중…' : '양식 파일 등록'}</span>
                </button>
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

            // 메뉴를 연 시점에 권한이 없었거나 그 사이 권한이 바뀐 경우를 막는다.
            if (!target.canChange) {
              showToast({
                title: '파일 삭제 실패',
                content: '파일을 삭제할 권한이 없습니다.',
                created_at: new Date().toISOString(),
              })
              setDeleteConfirmTarget(null)
              return
            }

            try {
              if (target.file.fileType === 'recurring_rule') {
                const fileId = target.file.fileId ?? target.file.id
                const res = await deleteRecurringRuleFile(fileId)
                if (res.status === 'error') {
                  throw new Error(res.message || '파일 삭제에 실패했습니다.')
                }
              } else {
                const { deleteWorkItemFile } = await import('../data/fileService')
                await deleteWorkItemFile(target.file.id)
              }

              showToast({
                title: '파일 삭제 완료',
                content: `'${target.file.originalFileName}' 파일이 삭제되어 휴지통으로 이동되었습니다.`,
                created_at: new Date().toISOString(),
              })
              if (target.onDeleted) {
                await target.onDeleted()
              }
            } catch (error) {
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
