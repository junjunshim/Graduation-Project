import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import styles from './TaskFilterDropdown.module.css'

type Option = { value: string; label: string; icon?: ReactNode }

export function TaskFilterDropdown({ label, value, options, onChange }: {
  label: string
  value: string
  options: Option[]
  onChange: (value: string) => void
}) {
  const id = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null)
  const selected = options.find((option) => option.value === value)

  function close() {
    setPosition(null)
  }

  function open() {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const below = window.innerHeight - rect.bottom - 12
    const above = rect.top - 12
    const height = Math.min(280, options.length * 36 + 12)
    const upwards = below < height && above > below
    const maxHeight = Math.max(36, Math.min(280, upwards ? above : below))
    setPosition({
      top: upwards ? rect.top - Math.min(height, maxHeight) - 4 : rect.bottom + 4,
      left: rect.left,
      width: rect.width,
      maxHeight,
    })
  }

  useEffect(() => {
    if (!position) return
    menuRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus()
    function outside(event: MouseEvent) {
      const target = event.target as Node
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) close()
    }
    function scroll(event: Event) {
      if (!menuRef.current?.contains(event.target as Node)) close()
    }
    document.addEventListener('mousedown', outside)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', scroll, true)
    return () => {
      document.removeEventListener('mousedown', outside)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', scroll, true)
    }
  }, [position])

  return (
    <div className={styles.field}>
      <span id={`${id}-label`} className={styles.label}>{label}</span>
      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-haspopup="listbox"
        aria-expanded={Boolean(position)}
        aria-controls={position ? id : undefined}
        onClick={() => position ? close() : open()}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            open()
          }
        }}
      >
        {selected?.icon}
        <span id={`${id}-value`} className={styles.text}>{selected?.label ?? '전체'}</span>
        <Icon name="chevronDown" size={13} />
      </button>
      {position && createPortal(
        <div
          ref={menuRef}
          id={id}
          role="listbox"
          aria-label={label}
          className={styles.menu}
          style={position}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) close()
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault()
              close()
              triggerRef.current?.focus()
            }
            const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
            const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length
              : event.key === 'ArrowUp' ? (index - 1 + buttons.length) % buttons.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : null
            if (next !== null) {
              event.preventDefault()
              buttons[next]?.focus()
            }
          }}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={styles.option}
              onClick={() => {
                onChange(option.value)
                close()
                triggerRef.current?.focus()
              }}
            >
              {option.icon}
              <span className={styles.text}>{option.label}</span>
            </button>
          ))}
        </div>, document.body,
      )}
    </div>
  )
}
