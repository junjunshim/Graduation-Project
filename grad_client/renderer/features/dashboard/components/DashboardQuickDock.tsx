import { Link } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import styles from '../pages/DashboardPage.module.css'

export function DashboardQuickDock() {
  return (
    <aside className={styles.quickDock} aria-label="빠른 도구">
      <button type="button" aria-label="메시지">
        <Icon name="messageCircle" size={18} />
      </button>
      <button type="button" aria-label="멤버">
        <Icon name="users" size={18} />
      </button>
      <Link to="/work-items/new" aria-label="새 업무">
        <Icon name="plus" size={18} />
      </Link>
    </aside>
  )
}
