import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import {
  subscribeToLiveNotifications,
  type LiveNotificationPayload,
} from '../../workspace/data/workspaceCacheEvents'
import { navigateNotification } from './navigateNotification'
import styles from './NotificationToast.module.css'

type NotificationToastContainerProps = {
  userId?: string
}

type ToastMessage = LiveNotificationPayload & {
  toastId: string
}

export function NotificationToastContainer({ userId }: NotificationToastContainerProps = {}) {
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    const unsubscribe = subscribeToLiveNotifications((payload) => {
      const toastId = `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
      const newToast: ToastMessage = { ...payload, toastId }

      setToasts((prev) => [...prev.slice(-3), newToast])

      // 4초 후 자동 제거
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.toastId !== toastId))
      }, 4000)
    })

    return unsubscribe
  }, [])

  const handleDismiss = (toastId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    setToasts((prev) => prev.filter((t) => t.toastId !== toastId))
  }

  const handleClickToast = (toast: ToastMessage) => {
    handleDismiss(toast.toastId)
    navigateNotification(toast, navigate, userId)
  }

  if (toasts.length === 0 || typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <div className={styles.container} aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.toastId}
          className={styles.toastItem}
          onClick={() => handleClickToast(toast)}
          role="alert"
        >
          <div className={styles.toastIconWrapper}>
            <Icon name="bell" size={16} />
          </div>
          <div className={styles.toastContent}>
            <div className={styles.toastTitle}>{toast.title}</div>
            <div className={styles.toastMessage}>{toast.content}</div>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={(e) => handleDismiss(toast.toastId, e)}
            aria-label="닫기"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  )
}
