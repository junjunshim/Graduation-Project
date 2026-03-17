import { NavLink, Outlet } from 'react-router-dom'
import { navigationItems } from '../navigation'
import styles from './AppShell.module.css'

export function AppShell() {
  return (
    <div className={styles.shell}>
      <aside className={`glass-panel ${styles.sidebar}`}>
        <div className={styles.brand}>
          <p className={styles.eyebrow}>Graduation Project</p>
          <h1 className={styles.title}>Grad Client</h1>
        </div>

        <nav className={styles.nav} aria-label="주요 메뉴">
          {navigationItems.map((item, index) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                ['glass-button', styles.navItem, isActive ? styles.navItemActive : '']
                  .filter(Boolean)
                  .join(' ')
              }
            >
              <span className={styles.navIndex}>
                {String(index + 1).padStart(2, '0')}
              </span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  )
}
