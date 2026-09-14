import { type ReactNode, useEffect, useRef } from 'react'
import styles from './WorkspaceSchedulesTab.module.css'

export function ScheduleCardRow({ title, children }: { title: string; children: ReactNode }) {
  const rowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const row = rowRef.current
    if (!row) return

    let drag: { x: number; left: number } | null = null
    const stop = () => {
      drag = null
      row.classList.remove(styles.cardRowDragging)
      window.removeEventListener('mousemove', move, true)
      window.removeEventListener('mouseup', stop, true)
      window.removeEventListener('blur', stop)
    }
    const move = (event: MouseEvent) => {
      if (!drag) return
      if ((event.buttons & 1) === 0) {
        stop()
        return
      }
      row.scrollLeft = drag.left - (event.clientX - drag.x)
    }
    const start = (event: MouseEvent) => {
      if (event.button !== 0 || row.scrollWidth <= row.clientWidth) return
      if (event.target instanceof Element && event.target.closest('button, a, input, textarea, select')) return
      // Use document mouse events, without taking capture from the browser.
      event.preventDefault()
      stop()
      drag = { x: event.clientX, left: row.scrollLeft }
      row.classList.add(styles.cardRowDragging)
      window.addEventListener('mousemove', move, true)
      window.addEventListener('mouseup', stop, true)
      window.addEventListener('blur', stop)
    }
    const wheel = (event: WheelEvent) => {
      if (!event.shiftKey || event.ctrlKey || event.metaKey || event.deltaX !== 0) return
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? row.clientWidth : 1
      const next = Math.max(0, Math.min(row.scrollWidth - row.clientWidth, row.scrollLeft + event.deltaY * unit))
      if (next === row.scrollLeft) return
      event.preventDefault()
      row.scrollLeft = next
    }
    row.addEventListener('mousedown', start)
    row.addEventListener('wheel', wheel, { passive: false })
    return () => {
      stop()
      row.removeEventListener('mousedown', start)
      row.removeEventListener('wheel', wheel)
    }
  }, [])

  return (
    <div
      ref={rowRef}
      className={styles.recurringCardGrid}
      role="region"
      aria-label={`${title} 일정 목록`}
      title="좌우로 드래그하거나 Shift + 휠로 이동"
      tabIndex={0}
    >
      {children}
    </div>
  )
}
