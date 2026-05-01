import { Icon } from '../../../design-system/primitives/Icon'
import styles from '../pages/DashboardPage.module.css'

type DashboardToolbarProps = {
  searchQuery: string
  dueSoonOpenCount: number
  currentUser: {
    name: string
    userId: string
  }
  onSearchQueryChange: (value: string) => void
}

export function DashboardToolbar({
  searchQuery,
  dueSoonOpenCount,
  currentUser,
  onSearchQueryChange,
}: DashboardToolbarProps) {
  return (
    <header className={styles.workspaceToolbar}>
      <label className={styles.searchBox}>
        <span className={styles.searchIcon}>
          <Icon name="search" size={18} />
        </span>
        <span className={styles.srOnly}>대시보드 검색</span>
        <input
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="업무, 문서, 상태 검색"
        />
      </label>

      <div className={styles.toolbarActions}>
        <button type="button" className={styles.iconButton} aria-label="알림">
          <Icon name="bell" size={18} />
          {dueSoonOpenCount > 0 ? <span className={styles.notificationDot} /> : null}
        </button>
        <button type="button" className={styles.iconButton} aria-label="도움말">
          <Icon name="helpCircle" size={18} />
        </button>
        <div className={styles.profileChip}>
          <span className={styles.profileAvatar}>
            <Icon name="user" size={17} />
          </span>
          <span className={styles.profileCopy}>
            <strong>{currentUser.name}</strong>
            <span>{currentUser.userId}</span>
          </span>
        </div>
      </div>
    </header>
  )
}
