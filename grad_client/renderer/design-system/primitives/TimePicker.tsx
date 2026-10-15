import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from './Icon'
import styles from './TimePicker.module.css'

export type TimePickerProps = {
  label: string
  /** 'HH:mm' 포맷 (예: '09:00', '14:30') */
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  className?: string
}

export function TimePicker({
  label,
  value,
  onChange,
  disabled = false,
  className,
}: TimePickerProps) {
  const id = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [position, setPosition] = useState<{ top: number; left: number; width: number } | null>(null)

  // 현재 value ('HH:mm') 파싱
  const [currentH, currentM] = (value || '09:00').split(':').map((v) => parseInt(v, 10) || 0)
  const isPM = currentH >= 12
  const period = isPM ? 'PM' : 'AM'
  const displayH12 = currentH % 12 === 0 ? 12 : currentH % 12
  const displayPeriodLabel = isPM ? '오후' : '오전'
  const displayMinuteStr = String(currentM).padStart(2, '0')
  const formattedText = `${displayPeriodLabel} ${displayH12}:${displayMinuteStr}`

  // 패널 위치 계산 (포털용)
  const updatePosition = () => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const PANEL_HEIGHT = 270
    const spaceBelow = window.innerHeight - rect.bottom
    const upwards = spaceBelow < PANEL_HEIGHT && rect.top > spaceBelow

    setPosition({
      top: upwards ? rect.top - PANEL_HEIGHT - 6 : rect.bottom + 6,
      left: rect.left,
      width: Math.max(260, rect.width),
    })
  }

  const handleOpen = () => {
    if (disabled) return
    updatePosition()
    setIsOpen(true)
  }

  const handleClose = () => {
    setIsOpen(false)
  }

  // 외부 클릭 및 리사이즈 시 닫기
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        panelRef.current &&
        !panelRef.current.contains(target)
      ) {
        handleClose()
      }
    }

    const handleScroll = (e: Event) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        handleClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('resize', handleClose)
    window.addEventListener('scroll', handleScroll, true)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('resize', handleClose)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [isOpen])

  // 시간 변경 헬퍼
  const setPeriod = (nextPeriod: 'AM' | 'PM') => {
    let nextH = currentH % 12
    if (nextPeriod === 'PM') nextH += 12
    onChange(`${String(nextH).padStart(2, '0')}:${String(currentM).padStart(2, '0')}`)
  }

  const setHour12 = (h12: number) => {
    let nextH = h12 % 12
    if (isPM) nextH += 12
    onChange(`${String(nextH).padStart(2, '0')}:${String(currentM).padStart(2, '0')}`)
  }

  const setMinute = (m: number) => {
    onChange(`${String(currentH).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  }

  return (
    <div className={styles.container}>
      <label id={`${id}-label`} className={styles.label}>
        {label}
      </label>

      <button
        ref={triggerRef}
        id={`${id}-trigger`}
        type="button"
        disabled={disabled}
        className={[styles.trigger, isOpen ? styles.triggerOpen : '', className].filter(Boolean).join(' ')}
        onClick={() => (isOpen ? handleClose() : handleOpen())}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-labelledby={`${id}-label ${id}-trigger`}
      >
        <span className={styles.triggerValue}>
          <Icon name="clock" size={15} className={styles.triggerIcon} />
          <strong className={styles.triggerText}>{formattedText}</strong>
          <span className={styles.trigger24h}>({value || '09:00'})</span>
        </span>
        <Icon
          name="chevronDown"
          size={14}
          className={[styles.chevron, isOpen ? styles.chevronOpen : ''].filter(Boolean).join(' ')}
        />
      </button>

      {isOpen &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={`${label} 선택`}
            className={styles.popover}
            style={{
              top: `${position.top}px`,
              left: `${position.left}px`,
              minWidth: `${position.width}px`,
            }}
          >
            {/* 상단 현재 선택 프리뷰 */}
            <div className={styles.panelHeader}>
              <span className={styles.previewLabel}>선택된 시간</span>
              <strong className={styles.previewTime}>{formattedText}</strong>
            </div>

            {/* 3개 열 (오전/오후, 시 1~12, 분 00~55) */}
            <div className={styles.columnsWrapper}>
              {/* 1열: 오전 / 오후 */}
              <div className={styles.column}>
                <span className={styles.columnTitle}>구분</span>
                <div className={styles.columnList}>
                  <button
                    type="button"
                    className={[styles.itemBtn, period === 'AM' ? styles.itemBtnActive : ''].join(' ')}
                    onClick={() => setPeriod('AM')}
                  >
                    오전
                  </button>
                  <button
                    type="button"
                    className={[styles.itemBtn, period === 'PM' ? styles.itemBtnActive : ''].join(' ')}
                    onClick={() => setPeriod('PM')}
                  >
                    오후
                  </button>
                </div>
              </div>

              {/* 2열: 시간 (1시 ~ 12시) */}
              <div className={styles.column}>
                <span className={styles.columnTitle}>시</span>
                <div className={styles.columnList}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => {
                    const isSelected = displayH12 === h
                    return (
                      <button
                        key={h}
                        type="button"
                        className={[styles.itemBtn, isSelected ? styles.itemBtnActive : ''].join(' ')}
                        onClick={() => setHour12(h)}
                      >
                        {h}시
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* 3열: 분 (00 ~ 55, 5분 단위) */}
              <div className={styles.column}>
                <span className={styles.columnTitle}>분</span>
                <div className={styles.columnList}>
                  {[0, 5, 10, 15, 20, 25, 30, 35, 40, 41, 45, 50, 55].filter((v, idx, arr) => arr.indexOf(v) === idx || v === currentM).sort((a,b) => a-b).map((m) => {
                    const isSelected = currentM === m
                    return (
                      <button
                        key={m}
                        type="button"
                        className={[styles.itemBtn, isSelected ? styles.itemBtnActive : ''].join(' ')}
                        onClick={() => setMinute(m)}
                      >
                        {String(m).padStart(2, '0')}분
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {/* 하단 닫기/확인 버튼 */}
            <div className={styles.panelFooter}>
              <button
                type="button"
                className={styles.confirmBtn}
                onClick={handleClose}
              >
                확인
              </button>
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
