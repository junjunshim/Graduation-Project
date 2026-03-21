import { NavLink } from 'react-router-dom'
import { ThemeToggle } from '../../design-system/theme/ThemeToggle'
import type { ShellPageMeta } from './shellPageMeta'
import styles from './AppShell.module.css'

type WorkspacePageHeaderProps = {
  currentUser: {
    name: string
    email: string
  }
  workspaceLabel: string
  pageMeta: ShellPageMeta
}

export function WorkspacePageHeader({ currentUser, workspaceLabel, pageMeta }: WorkspacePageHeaderProps) {
  return (
    <header className={styles.pageBar}>
      <div className={styles.pageMeta}>
        <p className={styles.pageEyebrow}>
          {workspaceLabel} / {pageMeta.section}
        </p>
        <h1 className={styles.pageTitle}>{pageMeta.title}</h1>
        <p className={styles.pageDescription}>{pageMeta.description}</p>
      </div>

      <div className={styles.pageActions}>
        <ThemeToggle />
        <div className={styles.userChip}>
          <span className={styles.userName}>{currentUser.name}</span>
          <span className={styles.userSubtext}>{currentUser.email}</span>
        </div>
        <NavLink to={pageMeta.actionTo} className={styles.primaryAction}>
          {pageMeta.actionLabel}
        </NavLink>
      </div>
    </header>
  )
}
