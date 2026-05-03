import styles from '../pages/DashboardPage.module.css'

export function DashboardEmptyState({ children }: { children: string }) {
  return <p className={styles.emptyState}>{children}</p>
}
