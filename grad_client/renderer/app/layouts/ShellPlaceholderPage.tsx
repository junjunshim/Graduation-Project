import { Link } from 'react-router-dom'
import styles from './AppShell.module.css'

type ShellPlaceholderPageProps = {
  eyebrow: string
  title: string
  description: string
  actionLabel?: string
  actionTo?: string
}

export function ShellPlaceholderPage({
  eyebrow,
  title,
  description,
  actionLabel,
  actionTo,
}: ShellPlaceholderPageProps) {
  return (
    <section className={styles.placeholderPage}>
      <p className={styles.placeholderEyebrow}>{eyebrow}</p>
      <h1 className={styles.placeholderTitle}>{title}</h1>
      <p className={styles.placeholderDescription}>{description}</p>
      {actionLabel && actionTo ? (
        <Link to={actionTo} className={styles.placeholderAction}>
          {actionLabel}
        </Link>
      ) : null}
    </section>
  )
}
