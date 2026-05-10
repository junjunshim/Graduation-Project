import { useState } from 'react'
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

  return (
    <header className={styles.shellTopActions}>
      <label className={styles.shellSearchBox}>
        <span className={styles.shellSearchIcon}>
          <Icon name="search" size={16} />
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
          <Icon name="bell" size={22} />
        </button>
        <button
          type="button"
          className={styles.shellProfileButton}
          aria-label="User menu"
          title={`${currentUser.name} (${currentUser.userId})`}
        >
          <Icon name="user" size={22} />
        </button>
      </div>
    </header>
  )
}
