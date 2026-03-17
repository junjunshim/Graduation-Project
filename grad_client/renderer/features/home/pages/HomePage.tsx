import { Link } from 'react-router-dom'
import styles from './HomePage.module.css'

export function HomePage() {
  return (
    <section className={styles.panel}>
      <div className={styles.overlay} aria-hidden="true">
        <span className={`${styles.orb} ${styles.orbPrimary}`} />
        <span className={`${styles.orb} ${styles.orbSecondary}`} />
        <span className={styles.grid} />
      </div>
    </section>
  )
}
