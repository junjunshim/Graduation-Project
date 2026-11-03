import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import type { LegalDocument } from '../model/legalDocuments'
import styles from './LegalDocumentDialog.module.css'

type LegalDocumentDialogProps = {
  legalDocument: LegalDocument | null
  onClose: () => void
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

export function LegalDocumentDialog({ legalDocument, onClose }: LegalDocumentDialogProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!legalDocument) return

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key !== 'Tab') return

      const dialog = dialogRef.current
      if (!dialog) return

      const focusableElements = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      if (focusableElements.length === 0) {
        event.preventDefault()
        dialog.focus()
        return
      }

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]

      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault()
        lastElement.focus()
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault()
        firstElement.focus()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [legalDocument, onClose])

  if (!legalDocument) return null

  return createPortal(
    <div
      className={styles.overlay}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div
        ref={dialogRef}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <span className={styles.iconBadge} aria-hidden="true">
              <Icon name="fileText" size={19} />
            </span>
            <div className={styles.titleCopy}>
              <h2 id={titleId} className={styles.title}>
                {legalDocument.title}
              </h2>
              <p className={styles.description}>{legalDocument.description}</p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="문서 닫기"
          >
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className={styles.body}>
          <div className={styles.metadata}>
            <span>시행일</span>
            <strong>{legalDocument.effectiveDate}</strong>
          </div>

          <div className={styles.sections}>
            {legalDocument.sections.map((section) => (
              <section key={section.title} className={styles.section}>
                <h3>{section.title}</h3>
                {section.paragraphs?.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                {section.bullets ? (
                  <ul>
                    {section.bullets.map((bullet) => (
                      <li key={bullet}>{bullet}</li>
                    ))}
                  </ul>
                ) : null}
              </section>
            ))}
          </div>
        </div>

        <footer className={styles.footer}>
          <span>문의: 서비스 내 문의 채널 · Axis 운영팀</span>
          <button type="button" className={styles.confirmButton} onClick={onClose}>
            확인
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
