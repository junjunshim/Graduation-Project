// 상단 공통 영역(ShellTopActions)의 사용자 아이콘 메뉴.
// 사용자 정보를 보여 주고, 자격증명 설정 팝업으로 들어가는 입구를 둔다.
import { useEffect, useRef, useState } from 'react'
import { Button } from '../../../design-system/primitives/Button'
import { Icon } from '../../../design-system/primitives/Icon'
import { UserAvatar } from '../../../design-system/primitives/UserAvatar'
import { GitHubCredentialDialog } from './GitHubCredentialDialog'
import styles from './UserMenuPopover.module.css'

type UserMenuPopoverProps = {
  userId: string
  name: string
  buttonClassName?: string
}

export function UserMenuPopover({ userId, name, buttonClassName }: UserMenuPopoverProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [isCredentialOpen, setIsCredentialOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // 바깥 클릭으로 닫는다(알림 팝오버와 같은 방식).
  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handleClickOutside(event: MouseEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <Button
        variant="icon"
        className={[styles.trigger, buttonClassName ?? ''].filter(Boolean).join(' ')}
        aria-label="사용자 메뉴"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        title={`${name} (${userId})`}
        onClick={() => setIsOpen((previous) => !previous)}
      >
        <Icon name="user" size={20} />
      </Button>

      {isOpen ? (
        <div className={styles.popover} role="dialog" aria-label="사용자 메뉴">
          <div className={styles.profile}>
            <UserAvatar name={name} userId={userId} size="medium" />
            <div className={styles.profileText}>
              <span className={styles.profileName}>{name || '사용자'}</span>
              <span className={styles.profileUserId}>{userId}</span>
            </div>
          </div>

          <button
            type="button"
            className={styles.menuItem}
            onClick={() => {
              setIsOpen(false)
              setIsCredentialOpen(true)
            }}
          >
            <Icon name="lock" size={16} className={styles.menuIcon} />
            <span className={styles.menuLabel}>GitHub 자격증명</span>
            <Icon name="chevronRight" size={15} className={styles.menuChevron} />
          </button>
        </div>
      ) : null}

      <GitHubCredentialDialog isOpen={isCredentialOpen} onClose={() => setIsCredentialOpen(false)} />
    </div>
  )
}