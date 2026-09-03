import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Button } from './Button'
import { Icon, type IconName } from './Icon'
import styles from './ToastAlertModal.module.css'

export type AlertType = 'error' | 'warning' | 'info' | 'success'

export type ToastAlertModalProps = {
  isOpen: boolean
  onClose: () => void
  title?: string
  message: string
  type?: AlertType
  confirmText?: string
}

export function ToastAlertModal({
  isOpen,
  onClose,
  title,
  message,
  type = 'error',
  confirmText = '확인',
}: ToastAlertModalProps) {
  // ESC 키로 닫기
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const getIcon = (): { name: IconName; className: string; defaultTitle: string } => {
    switch (type) {
      case 'error':
        return { name: 'alertTriangle', className: styles.iconError, defaultTitle: '오류 안내' }
      case 'warning':
        return { name: 'alertTriangle', className: styles.iconWarning, defaultTitle: '주의 안내' }
      case 'info':
        return { name: 'sparkles', className: styles.iconInfo, defaultTitle: '안내' }
      case 'success':
        return { name: 'checkCircle', className: styles.iconSuccess, defaultTitle: '성공' }
    }
  }

  const { name: iconName, className: iconClassName, defaultTitle } = getIcon()
  const displayTitle = title || defaultTitle

  const modalTypeClass =
    type === 'error'
      ? styles.modalError
      : type === 'warning'
      ? styles.modalWarning
      : type === 'info'
      ? styles.modalInfo
      : styles.modalSuccess

  return createPortal(
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true">
      <div className={[styles.modal, modalTypeClass].join(' ')} onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <Icon name={iconName} size={18} className={iconClassName} />
            <h3 className={styles.title}>{displayTitle}</h3>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="닫기">
            <Icon name="close" size={15} />
          </button>
        </header>

        <div className={styles.body}>
          <p className={styles.message}>{message}</p>
        </div>

        <footer className={styles.footer}>
          <Button
            variant="primary"
            onClick={onClose}
            className={styles.confirmBtn}
            autoFocus
          >
            {confirmText}
          </Button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
