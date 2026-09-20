import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import styles from './ConfirmDeleteModal.module.css'

export type WorkspaceDeleteModalProps = {
  isOpen: boolean
  workspaceName: string
  /** 함께 삭제(휴지통 이동)되는 하위 워크스페이스 목록 */
  descendantWorkspaces: Array<{ id: string; name: string }>
  /** 함께 삭제되는 업무 수 */
  descendantWorkItemCount: number
  onClose: () => void
  onConfirm: () => Promise<void> | void
}

export function WorkspaceDeleteModal({
  isOpen,
  workspaceName,
  descendantWorkspaces,
  descendantWorkItemCount,
  onClose,
  onConfirm,
}: WorkspaceDeleteModalProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const confirmBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isOpen) return
    confirmBtnRef.current?.focus()

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen || typeof document === 'undefined') return null

  const handleConfirmClick = async () => {
    setIsDeleting(true)
    try {
      await onConfirm()
    } finally {
      setIsDeleting(false)
      onClose()
    }
  }

  return createPortal(
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div className={styles.iconWrap}>
            <Icon name="trash" size={20} />
          </div>
          <h3 className={styles.title}>워크스페이스 삭제</h3>
        </div>

        <div className={styles.body}>
          <p>
            정말로 <span className={styles.targetName}>{workspaceName}</span> 워크스페이스를
            삭제(휴지통 이동)하시겠습니까?
          </p>

          {descendantWorkspaces.length > 0 ? (
            <div className={styles.attachedFilesWarning}>
              <div className={styles.attachedFilesWarningHeader}>
                <Icon name="alertTriangle" size={14} />
                <span>함께 삭제되는 하위 워크스페이스 ({descendantWorkspaces.length}개):</span>
              </div>
              <ul className={styles.attachedFilesList}>
                {descendantWorkspaces.map((workspace) => (
                  <li key={workspace.id} className={styles.attachedFileItem}>
                    <Icon name="chevronRight" size={13} className={styles.attachedFileIcon} />
                    <span className={styles.attachedFileName} title={workspace.name}>
                      {workspace.name}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {descendantWorkItemCount > 0 ? (
            <div className={styles.childCountWarning}>
              <Icon name="alertTriangle" size={14} />
              <span>소속 업무 {descendantWorkItemCount}개와 첨부파일도 함께 휴지통으로 이동합니다.</span>
            </div>
          ) : null}

          <p className={styles.warningNote}>
            삭제한 워크스페이스는 진입점 우측 상단의 휴지통 버튼을 켜면 흐릿하게 표시되며,
            우클릭 후 복구할 수 있습니다.
          </p>
        </div>

        <div className={styles.footer}>
          <button type="button" className={styles.cancelBtn} onClick={onClose} disabled={isDeleting}>
            취소
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className={styles.deleteBtn}
            onClick={handleConfirmClick}
            disabled={isDeleting}
          >
            {isDeleting ? '삭제 중…' : '삭제'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
