import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../../design-system/primitives/Button'
import { Icon } from '../../../design-system/primitives/Icon'
import { useNotificationStore, type NotificationItem } from '../data/notificationStore'
import { navigateNotification } from './navigateNotification'
import styles from './NotificationPopover.module.css'

type NotificationPopoverProps = {
  userId: string
  buttonClassName?: string
}

function formatRelativeTime(dateStr: string) {
  try {
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
    if (diff < 60) return '방금 전'
    if (diff < 3600) return `${Math.floor(diff / 60)}분 전`
    if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`
    return `${Math.floor(diff / 86400)}일 전`
  } catch {
    return ''
  }
}

export function NotificationPopover({ userId, buttonClassName }: NotificationPopoverProps) {
  const [isOpen, setIsOpen] = useState(false)
  const popoverRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  const { notifications, unreadCount, markAsRead, markAllAsRead, clearNotifications } =
    useNotificationStore(userId)

  // 외부 클릭 시 닫기
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const handleItemClick = (item: NotificationItem) => {
    markAsRead(item.id)
    setIsOpen(false)
    navigateNotification(item, navigate, userId)
  }

  return (
    <div className={styles.wrapper} ref={popoverRef}>
      <Button
        variant="icon"
        className={`${styles.bellButton} ${buttonClassName || ''}`}
        aria-label="알림"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <Icon name="bell" size={20} />
        {unreadCount > 0 && (
          <span className={styles.badge} aria-label={`읽지 않은 알림 ${unreadCount}개`}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </Button>

      {isOpen && (
        <div className={styles.popover} role="dialog" aria-label="알림 목록">
          <div className={styles.popoverHeader}>
            <span className={styles.popoverTitle}>알림</span>
            <div className={styles.headerActions}>
              {unreadCount > 0 && (
                <button
                  type="button"
                  className={styles.textActionBtn}
                  onClick={markAllAsRead}
                >
                  모두 읽음
                </button>
              )}
              {notifications.length > 0 && (
                <button
                  type="button"
                  className={styles.textActionBtn}
                  onClick={clearNotifications}
                >
                  전체 삭제
                </button>
              )}
            </div>
          </div>

          <div className={styles.notificationList}>
            {notifications.length === 0 ? (
              <div className={styles.emptyState}>새로운 알림이 없습니다.</div>
            ) : (
              notifications.map((item) => (
                <div
                  key={item.id}
                  className={`${styles.item} ${!item.is_read ? styles.itemUnread : ''}`}
                  onClick={() => handleItemClick(item)}
                  role="button"
                  tabIndex={0}
                >
                  <div className={styles.itemTop}>
                    <span className={styles.itemTitle}>
                      {!item.is_read && <span className={styles.unreadDot} />}
                      {item.title}
                    </span>
                    <span className={styles.itemTime}>
                      {formatRelativeTime(item.created_at)}
                    </span>
                  </div>
                  <div className={styles.itemMessage}>{item.content}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
