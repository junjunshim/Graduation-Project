import { useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from '../primitives/Icon'
import { useTheme, type ThemeMode } from './ThemeContext'
import styles from './ThemeToggle.module.css'

type ThemeToggleProps = {
  compact?: boolean
}

type ThemeOption = {
  mode: ThemeMode
  label: string
  subLabel: string
  icon: IconName
  previewColor: string
  previewBorder: string
  accentColor: string
}

const THEME_OPTIONS: ThemeOption[] = [
  {
    mode: 'white',
    label: '화이트',
    subLabel: '딥 틸 포인트',
    icon: 'sun',
    previewColor: '#FFFFFF',
    previewBorder: '#E2E8F0',
    accentColor: '#0D766E',
  },
  {
    mode: 'beige',
    label: '베이지',
    subLabel: '웜 모카 포인트',
    icon: 'sparkles',
    previewColor: '#F4F2EC',
    previewBorder: '#E2DDD2',
    accentColor: '#7A5C43',
  },
  {
    mode: 'navy',
    label: '미드나잇',
    subLabel: '스카이 블루 포인트',
    icon: 'globe',
    previewColor: '#0B1120',
    previewBorder: '#1E2E4A',
    accentColor: '#38BDF8',
  },
  {
    mode: 'dark',
    label: '다크',
    subLabel: '퍼플 포인트',
    icon: 'moon',
    previewColor: '#18191D',
    previewBorder: '#343741',
    accentColor: '#918CFF',
  },
]

export function ThemeToggle({ compact = false }: ThemeToggleProps) {
  const { themeMode, setThemeMode } = useTheme()
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const currentOption = THEME_OPTIONS.find((t) => t.mode === themeMode) ?? THEME_OPTIONS[0]

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  return (
    <div className={styles.container} ref={containerRef}>
      <button
        type="button"
        className={[styles.button, compact ? styles.compact : '', isOpen ? styles.buttonOpen : ''].filter(Boolean).join(' ')}
        onClick={() => setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`테마 선택 (현재: ${currentOption.label})`}
        data-tooltip={compact && !isOpen ? `테마: ${currentOption.label}` : undefined}
      >
        <span
          className={styles.themeSwatch}
          style={{
            background: currentOption.previewColor,
            borderColor: currentOption.previewBorder,
          }}
        >
          <i style={{ background: currentOption.accentColor }} />
        </span>
        {!compact ? <span className={styles.label}>{currentOption.label}</span> : null}
        <Icon name={isOpen ? 'chevronUp' : 'chevronDown'} size={12} className={styles.chevron} />
      </button>

      {isOpen && (
        <div className={styles.menu} role="listbox" aria-label="테마 선택 목록">
          <div className={styles.menuHeader}>테마 설정</div>
          {THEME_OPTIONS.map((opt) => {
            const isSelected = opt.mode === themeMode
            return (
              <button
                key={opt.mode}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={[styles.menuItem, isSelected ? styles.menuItemActive : ''].filter(Boolean).join(' ')}
                onClick={() => {
                  setThemeMode(opt.mode)
                  setIsOpen(false)
                }}
              >
                <span
                  className={styles.itemSwatch}
                  style={{
                    background: opt.previewColor,
                    borderColor: opt.previewBorder,
                  }}
                >
                  <i style={{ background: opt.accentColor }} />
                </span>
                <span className={styles.itemCopy}>
                  <strong className={styles.itemLabel}>{opt.label}</strong>
                  <small className={styles.itemSub}>{opt.subLabel}</small>
                </span>
                {isSelected && <Icon name="checkCircle" size={14} className={styles.checkIcon} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
