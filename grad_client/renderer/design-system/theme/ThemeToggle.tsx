import { Icon } from '../primitives/Icon'
import { useTheme } from './ThemeContext'
import styles from './ThemeToggle.module.css'

type ThemeToggleProps = {
  compact?: boolean
}

export function ThemeToggle({ compact = false }: ThemeToggleProps) {
  const { themeMode, toggleTheme } = useTheme()
  const nextModeLabel = themeMode === 'light' ? '다크 모드' : '라이트 모드'
  const iconName = themeMode === 'light' ? 'moon' : 'sun'

  return (
    <button
      type="button"
      className={[styles.button, compact ? styles.compact : ''].filter(Boolean).join(' ')}
      onClick={toggleTheme}
      aria-label={nextModeLabel}
      title={nextModeLabel}
    >
      <span className={styles.icon}>
        <Icon name={iconName} size={16} />
      </span>
      {!compact ? <span className={styles.label}>{nextModeLabel}</span> : null}
    </button>
  )
}
