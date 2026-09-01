import { ThemeToggle } from '../../design-system/theme/ThemeToggle'
import type { ShellPageMeta } from './shellPageMeta'
import styles from './AppShell.module.css'

type WorkspacePageHeaderProps = {
  workspaceLabel: string
  pageMeta: ShellPageMeta
}

export function WorkspacePageHeader({ pageMeta }: WorkspacePageHeaderProps) {
  return (
    <header className={styles.pageBar}>
      <div className={styles.pageMeta}>
        <h1 className={styles.pageTitle}>{pageMeta.title}</h1>
        <p className={styles.pageDescription}>{pageMeta.description}</p>
      </div>

      <div className={styles.pageActions}>
        <ThemeToggle />
      </div>
    </header>
  )
}
