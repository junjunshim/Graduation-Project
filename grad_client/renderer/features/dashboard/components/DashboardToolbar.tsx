{/* 변경된 구조 상 현재는 사용하지 않는 파일 */}
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
  currentUser,
  onSearchQueryChange,
}: DashboardToolbarProps) {
  return (
    <header className={styles.workspaceToolbar}>
      <label className={styles.searchBox}>
        <span className={styles.searchIcon}>
          <Icon name="search" size={16} />
        </span>
        <span className={styles.srOnly}>대시보드 검색</span>
        <input
          value={searchQuery}
          onChange={(event) => onSearchQueryChange(event.target.value)}
          placeholder="Search"
        />
      </label>

      <div className={styles.toolbarActions}>
        <button type="button" className={styles.iconButton} aria-label="알림">
          <Icon name="bell" size={26} />
          {/* 알림 아이콘에 알림 표시 */}
          {/* {dueSoonOpenCount > 0 ? <span className={styles.notificationDot} /> : null}  */}
        </button>
        <button
          type="button"
          className={styles.profileButton}
          aria-label="User menu"
          title={`${currentUser.name} (${currentUser.userId})`}
        >
          <Icon name="user" size={22} />
        </button>
      </div>
    </header>
  )
}
