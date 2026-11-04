import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import { requestPasswordReset } from '../api'
import { getEmailValidationError, normalizeEmailInput } from '../model/authValidation'
import styles from './PasswordResetDialog.module.css'

type PasswordResetDialogProps = {
  isOpen: boolean
  initialEmail: string
  onClose: () => void
}

type Feedback = {
  tone: 'error' | 'success' | 'info'
  message: string
}

export function PasswordResetDialog({ isOpen, initialEmail, onClose }: PasswordResetDialogProps) {
  const [email, setEmail] = useState(initialEmail)
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)

  useEffect(() => {
    if (!isOpen) return
    setEmail(initialEmail)
    setSubmitting(false)
    setSent(false)
    setFeedback(null)
  }, [initialEmail, isOpen])

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, submitting])

  if (!isOpen) return null

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting || sent) return

    const validationError = getEmailValidationError(email)
    if (validationError) {
      setFeedback({ tone: 'error', message: validationError })
      return
    }

    setSubmitting(true)
    setFeedback(null)

    try {
      const result = await requestPasswordReset(normalizeEmailInput(email))
      if (result.status === 'error') {
        setFeedback({ tone: 'error', message: result.message })
        return
      }

      setSent(true)
      setFeedback({ tone: 'success', message: result.message })
    } finally {
      setSubmitting(false)
    }
  }

  function handleRequestAgain() {
    setSent(false)
    setFeedback(null)
  }

  return createPortal(
    <div className={styles.overlay} onMouseDown={onClose} role="presentation">
      <div
        className={styles.dialog}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-reset-title"
      >
        <header className={styles.header}>
          <div className={styles.titleGroup}>
            <span className={styles.iconBadge} aria-hidden="true">
              <Icon name="lock" size={19} />
            </span>
            <div>
              <h2 id="password-reset-title" className={styles.title}>
                비밀번호 재설정
              </h2>
              <p className={styles.subtitle}>가입한 이메일로 안전한 재설정 링크를 보내드립니다.</p>
            </div>
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="닫기">
            <Icon name="close" size={16} />
          </button>
        </header>

        <form className={styles.body} onSubmit={handleSubmit} noValidate>
          {sent ? (
            <div className={styles.successPanel} role="status">
              <span className={styles.successIcon} aria-hidden="true">
                <Icon name="mail" size={24} />
              </span>
              <strong>재설정 안내를 요청했습니다.</strong>
              <p>{feedback?.message}</p>
              <ul>
                <li>메일의 링크는 30분 동안 한 번만 사용할 수 있습니다.</li>
                <li>메일이 보이지 않으면 스팸함도 확인해 주세요.</li>
              </ul>
            </div>
          ) : (
            <>
              <label className={styles.label} htmlFor="password-reset-email">
                이메일
              </label>
              <span className={styles.inputShell}>
                <Icon name="mail" size={19} className={styles.inputIcon} />
                <input
                  id="password-reset-email"
                  type="email"
                  autoComplete="email"
                  maxLength={100}
                  autoFocus
                  disabled={submitting}
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value)
                    setFeedback(null)
                  }}
                  className={styles.input}
                  placeholder="이메일 주소를 입력하세요"
                />
              </span>
              <p className={styles.hint}>계정 존재 여부와 관계없이 같은 안내가 표시됩니다.</p>
            </>
          )}

          {feedback?.tone === 'error' ? (
            <div className={styles.errorMessage} role="alert">
              {feedback.message}
            </div>
          ) : null}

          {sent ? (
            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={handleRequestAgain}>
                다시 요청
              </button>
              <button type="button" className={styles.primaryButton} onClick={onClose}>
                확인
              </button>
            </div>
          ) : (
            <div className={styles.actions}>
              <button type="button" className={styles.secondaryButton} onClick={onClose} disabled={submitting}>
                취소
              </button>
              <button type="submit" className={styles.primaryButton} disabled={submitting}>
                {submitting ? '요청 중...' : '재설정 메일 받기'}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>,
    document.body,
  )
}
