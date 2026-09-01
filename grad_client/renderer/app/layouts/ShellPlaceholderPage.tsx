import { Link } from 'react-router-dom'
import styles from './AppShell.module.css'

type ShellPlaceholderPageProps = {
  actionLabel?: string
  actionTo?: string
}

export function ShellPlaceholderPage({
  actionLabel,
  actionTo,
}: ShellPlaceholderPageProps) {
  return (
    <section className={styles.placeholderPage}>
      {actionLabel && actionTo ? (
        <Link to={actionTo} className={styles.placeholderAction}>
          {actionLabel}
        </Link>
      ) : null}
    </section>
  )
}
