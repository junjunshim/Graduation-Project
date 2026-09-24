import { useState } from 'react'
import { Icon } from '../../../design-system/primitives/Icon'
import styles from './FileContextMenu.module.css'
import { showToast } from '../../notification/data/toastEvents'
import { deleteWorkItemFile } from '../data/fileService'
import type { WorkItemFileRecord } from '../model/types'
import { ConfirmDeleteModal } from './ConfirmDeleteModal'

export function WorkItemFileDelete({
  file,
  onComplete,
  onDeleted,
  onRequestConfirm,
  disabled = false,
  disabledReason,
}: {
  file: WorkItemFileRecord
  onComplete?: () => void
  onDeleted?: () => Promise<void> | void
  onRequestConfirm?: () => void
  /** 권한이 없으면 메뉴 항목을 비활성화한다 (기본: 허용) */
  disabled?: boolean
  disabledReason?: string
}) {
  const [isConfirmOpen, setIsConfirmOpen] = useState(false)

  async function handleDeleteConfirm() {
    if (disabled) return
    try {
      await deleteWorkItemFile(file.id)
      showToast({
        title: '파일 삭제 완료',
        content: `'${file.originalFileName}' 파일이 삭제되어 휴지통으로 이동되었습니다.`,
        created_at: new Date().toISOString(),
      })
      if (onDeleted) {
        await onDeleted()
      }
    } catch (error) {
      showToast({
        title: '파일 삭제 실패',
        content: error instanceof Error ? error.message : '파일을 삭제하지 못했습니다.',
        created_at: new Date().toISOString(),
      })
    } finally {
      onComplete?.()
    }
  }

  return (
    <>
      <button
        type="button"
        className={[styles.deleteItem, disabled ? styles.permissionDenied : ''].join(' ')}
        role="menuitem"
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        aria-label={`${file.originalFileName} 삭제`}
        onClick={(event) => {
          event.stopPropagation()
          if (onRequestConfirm) {
            onRequestConfirm()
          } else {
            setIsConfirmOpen(true)
          }
        }}
      >
        <Icon name="trash" size={15} />
        <span>삭제</span>
      </button>

      {isConfirmOpen && (
        <ConfirmDeleteModal
          isOpen={isConfirmOpen}
          title="파일 삭제"
          itemName={file.originalFileName}
          itemTypeLabel="파일"
          warningText="삭제된 파일은 휴지통으로 이동되며 15일간 보관 후 영구 삭제됩니다."
          onClose={() => {
            setIsConfirmOpen(false)
            onComplete?.()
          }}
          onConfirm={handleDeleteConfirm}
        />
      )}
    </>
  )
}
