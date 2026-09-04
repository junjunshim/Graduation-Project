import { Icon, type IconName } from '../../../design-system/primitives/Icon'
import styles from '../pages/DashboardPage.module.css'

export function DashboardEmptyState({
  icon = 'sparkles',
  title,
  children,
  compact = false,
}: {
  icon?: IconName
  title?: string
  children?: string
  compact?: boolean
}) {
  return (
    <div className={[styles.emptyStateBox, compact ? styles.emptyStateBoxCompact : ''].filter(Boolean).join(' ')}>
      <span className={styles.emptyStateIconWrapper}>
        <Icon name={icon} size={compact ? 18 : 26} />
      </span>
      {title ? <strong className={styles.emptyStateTitle}>{title}</strong> : null}
      {children ? <p className={styles.emptyStateDesc}>{children}</p> : null}
    </div>
  )
}
