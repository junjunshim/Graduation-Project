{/* 각 페이지의 상단 액션(알림, 프로필 등) 관리 */}
import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Icon } from '../../design-system/primitives/Icon'
import styles from './ShellTopActions.module.css'

type ShellTopActionsProps = {
  currentUser: {
    name: string
    userId: string
  }
}

export function ShellTopActions({ currentUser }: ShellTopActionsProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const { pathname } = useLocation()
  const shouldShowGreeting = pathname === '/dashboard'

  return (
    <header className={styles.shellTopActions}>
      {shouldShowGreeting ? (
        <p className={styles.shellGreeting}>
          안녕, {currentUser.name}님
          <span className={styles.shellGreetingIcon}>
            <Icon name="hand" size={32} />
          </span>
        </p>
      ) : null}

      <div className={styles.shellRightActions}>
        <label className={styles.shellSearchBox}>
          <span className={styles.shellSearchIcon}>
            <Icon name="search" size={18} />
          </span>
          <span className={styles.srOnly}>Search</span>
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search"
          />
        </label>

        <div className={styles.shellActionButtons}>
          <button type="button" className={styles.shellIconButton} aria-label="Notifications">
            <Icon name="bell" size={30} />
          </button>
          <button type="button" className={styles.shellIconButton} aria-label="Help">
            <Icon name="helpCircle" size={34} />
          </button>
          <button
            type="button"
            className={styles.shellProfileButton}
            aria-label="User menu"
            title={`${currentUser.name} (${currentUser.userId})`}
          >
            <span className={styles.shellProfileIcon}>
              <Icon name="user" size={28} />
            </span>
            <span className={styles.shellProfileName}>{currentUser.name}</span>
            <Icon name="chevronDown" size={18} />
          </button>
        </div>
      </div>
    </header>
  )
}
