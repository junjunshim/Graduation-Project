import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import styles from './ConfirmDeleteModal.module.css'

export type ConfirmDeleteModalProps = {
  isOpen: boolean
  title: string
  itemName: string
  itemTypeLabel: string
  warningText?: string
  onClose: () => void
  onConfirm: () => Promise<void> | void
}

export function ConfirmDeleteModal({
  isOpen,
  title,
  itemName,
  itemTypeLabel,
  warningText,
  onClose,
  onConfirm,
}: ConfirmDeleteModalProps) {
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
          <h3 className={styles.title}>{title}</h3>
        </div>

        <div className={styles.body}>
          <p>
            정말로 <span className={styles.targetName}>{itemName}</span> {itemTypeLabel}을(를) 삭제하시겠습니까?
          </p>
          <p className={styles.warningNote}>
            {warningText || '삭제된 항목은 휴지통으로 이동되며 15일간 보관 후 영구 삭제됩니다.'}
          </p>
        </div>

        <div className={styles.footer}>
          <button
            type="button"
            className={styles.cancelBtn}
            onClick={onClose}
            disabled={isDeleting}
          >
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
