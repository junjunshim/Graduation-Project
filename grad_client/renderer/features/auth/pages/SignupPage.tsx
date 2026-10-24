import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { WindowTitleBar } from '../../../app/chrome/WindowTitleBar'
import { hasCustomWindowControls } from '../../../app/chrome/windowControls'
import { useBodyScrollSurface } from '../../../app/chrome/useBodyScrollSurface'
import { AxisMark } from '../../../design-system/primitives/AxisMark'
import { Icon } from '../../../design-system/primitives/Icon'
import { useTheme } from '../../../design-system/theme/ThemeContext'
import { ThemeToggle } from '../../../design-system/theme/ThemeToggle'
import {
  confirmSignupEmailVerification,
  getCurrentUser,
  requestSignupEmailVerification,
  signUp,
} from '../api'
import { getAuthIllustrationUrl } from '../model/authAssets'
import {
  getEmailValidationError,
  getPasswordValidationError,
  normalizeEmailInput,
} from '../model/authValidation'
import styles from './SignupPage.module.css'

const initialForm = {
  userId: '',
  email: '',
  name: '',
  password: '',
}

const RESEND_COOLDOWN_SECONDS = 60

type VerificationStage = 'email' | 'code' | 'verified'
type Feedback = { message: string }
type ErrorField = 'userId' | 'email' | 'code' | 'name' | 'password' | 'all' | null

export function SignupPage() {
  const navigate = useNavigate()
  const { themeMode } = useTheme()
  const currentUser = getCurrentUser()
  const hasCustomTitleBar = hasCustomWindowControls()
  const [form, setForm] = useState(initialForm)
  const [verificationStage, setVerificationStage] = useState<VerificationStage>('email')
  const [verificationCode, setVerificationCode] = useState('')
  const [verificationToken, setVerificationToken] = useState('')
  const [resendCooldown, setResendCooldown] = useState(0)
  const [showPassword, setShowPassword] = useState(false)
  const [requestingCode, setRequestingCode] = useState(false)
  const [confirmingCode, setConfirmingCode] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [errorField, setErrorField] = useState<ErrorField>(null)
  const mountedRef = useRef(true)
  const codeInputRef = useRef<HTMLInputElement>(null)

  useBodyScrollSurface(hasCustomTitleBar ? 'auth' : undefined)

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    if (resendCooldown <= 0) {
      return
    }

    const timer = window.setTimeout(() => {
      setResendCooldown((current) => Math.max(0, current - 1))
    }, 1000)

    return () => window.clearTimeout(timer)
  }, [resendCooldown])

  useEffect(() => {
    if (verificationStage === 'code') {
      codeInputRef.current?.focus()
    }
  }, [verificationStage])

  if (currentUser) {
    return <Navigate to="/dashboard" replace />
  }

  const isBusy = submitting || requestingCode || confirmingCode
  const canEditDetails = verificationStage === 'verified' && !isBusy

  function resetVerification() {
    setVerificationStage('email')
    setVerificationCode('')
    setVerificationToken('')
    setResendCooldown(0)
    setFeedback(null)
    setErrorField(null)
  }

  async function handleRequestCode() {
    if (requestingCode || submitting) {
      return
    }

    setFeedback(null)
    setErrorField(null)

    const emailError = getEmailValidationError(form.email)
    if (emailError) {
      setFeedback({ message: emailError })
      setErrorField('email')
      return
    }

    const normalizedEmail = normalizeEmailInput(form.email)
    setRequestingCode(true)

    try {
      const response = await requestSignupEmailVerification(normalizedEmail)

      if (!mountedRef.current) {
        return
      }

      if (response.status === 'error') {
        setFeedback({ message: response.message })
        setErrorField('email')
        return
      }

      setForm((current) => ({ ...current, email: normalizedEmail }))
      setVerificationStage('code')
      setVerificationCode('')
      setVerificationToken('')
      setResendCooldown(RESEND_COOLDOWN_SECONDS)
    } catch {
      if (mountedRef.current) {
        setFeedback({ message: '인증번호 요청 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.' })
        setErrorField('email')
      }
    } finally {
      if (mountedRef.current) {
        setRequestingCode(false)
      }
    }
  }

  async function handleConfirmCode() {
    if (confirmingCode || submitting) {
      return
    }

    setFeedback(null)
    setErrorField(null)

    const code = verificationCode.trim()
    if (!/^\d{6}$/.test(code)) {
      setFeedback({ message: '이메일로 받은 6자리 인증번호를 입력해 주세요.' })
      setErrorField('code')
      return
    }

    setConfirmingCode(true)

    try {
      const response = await confirmSignupEmailVerification(form.email, code)

      if (!mountedRef.current) {
        return
      }

      if (response.status === 'error') {
        setFeedback({ message: response.message })
        setErrorField('code')
        return
      }

      setVerificationToken(response.verificationToken)
      setVerificationStage('verified')
      setResendCooldown(0)
    } catch {
      if (mountedRef.current) {
        setFeedback({ message: '인증번호 확인 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.' })
        setErrorField('code')
      }
    } finally {
      if (mountedRef.current) {
        setConfirmingCode(false)
      }
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (verificationStage === 'email') {
      await handleRequestCode()
      return
    }

    if (verificationStage === 'code') {
      await handleConfirmCode()
      return
    }

    if (submitting) {
      return
    }

    setFeedback(null)
    setErrorField(null)

    if (!verificationToken) {
      resetVerification()
      setFeedback({ message: '이메일 인증을 다시 진행해 주세요.' })
      setErrorField('all')
      return
    }

    const userIdTrimmed = form.userId.trim()
    if (!userIdTrimmed) {
      setFeedback({ message: '아이디를 입력해 주세요.' })
      setErrorField('userId')
      return
    }

    const userIdRegex = /^[a-zA-Z0-9][a-zA-Z0-9_-]{3,29}$/
    if (!userIdRegex.test(userIdTrimmed)) {
      setFeedback({
        message: '아이디는 4~30자의 영문, 숫자, 하이픈(-), 언더바(_)만 사용할 수 있으며 영문이나 숫자로 시작해야 합니다.',
      })
      setErrorField('userId')
      return
    }

    const nameTrimmed = form.name.trim()
    if (!nameTrimmed) {
      setFeedback({ message: '닉네임을 입력해 주세요.' })
      setErrorField('name')
      return
    }

    if (nameTrimmed.length > 50) {
      setFeedback({ message: '닉네임은 최대 50자까지 입력할 수 있습니다.' })
      setErrorField('name')
      return
    }

    const passwordError = getPasswordValidationError(form.password)
    if (passwordError) {
      setFeedback({ message: passwordError })
      setErrorField('password')
      return
    }

    setSubmitting(true)

    try {
      const response = await signUp({
        userId: userIdTrimmed,
        email: form.email,
        name: nameTrimmed,
        password: form.password,
        verificationToken,
      })

      if (!mountedRef.current) {
        return
      }

      if (response.status === 'error') {
        if ('accountCreated' in response && response.accountCreated) {
          navigate('/login', {
            replace: true,
            state: { notice: response.message },
          })
          return
        }

        const msg = response.message || '가입 정보를 다시 확인해 주세요.'
        setFeedback({ message: msg })

        if (msg.includes('이메일 인증')) {
          setVerificationStage('email')
          setVerificationCode('')
          setVerificationToken('')
          setResendCooldown(0)
          setErrorField('email')
        } else if (msg.includes('아이디') || msg.toLowerCase().includes('user_id') || msg.toLowerCase().includes('userid')) {
          setErrorField('userId')
        } else if (msg.includes('이메일') || msg.toLowerCase().includes('email')) {
          setErrorField('email')
        } else if (msg.includes('닉네임') || msg.includes('이름') || msg.toLowerCase().includes('name')) {
          setErrorField('name')
        } else if (msg.includes('비밀번호') || msg.toLowerCase().includes('password')) {
          setErrorField('password')
        } else {
          setErrorField('all')
        }
        return
      }

      navigate('/dashboard', { replace: true })
    } catch {
      if (mountedRef.current) {
        setFeedback({ message: '회원가입 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.' })
      }
    } finally {
      if (mountedRef.current) {
        setSubmitting(false)
      }
    }
  }

  return (
    <main
      className={[styles.page, hasCustomTitleBar ? styles.pageWithCustomChrome : '']
        .filter(Boolean)
        .join(' ')}
    >
      {hasCustomTitleBar ? (
        <div className={styles.titleBarSlot}>
          <WindowTitleBar variant="auth" />
        </div>
      ) : null}

      <section className={styles.surface}>
        <div className={styles.backgroundDecor} aria-hidden="true">
          <span className={styles.topGlow} />
          <span className={styles.waveBack} />
          <span className={styles.waveFront} />
          <span className={`${styles.decorDot} ${styles.dotOne}`} />
          <span className={`${styles.decorDot} ${styles.dotTwo}`} />
          <span className={`${styles.decorDot} ${styles.dotThree}`} />
        </div>

        <header className={styles.utilityBar}>
          <div className={styles.utilityActions}>
            {!hasCustomTitleBar ? <ThemeToggle compact /> : null}
          </div>
        </header>

        <div className={styles.content}>
          <aside className={styles.visualPanel} aria-label="Axis 소개">
            <span className={styles.axisBrand}>
              <span className={styles.axisLogoWrap}>
                <AxisMark size={52} className={styles.axisLogo} />
              </span>
              <span className={styles.axisTitle}>Axis</span>
            </span>

            <p className={styles.heroTitle}>
              함께 일하는
              <br />더 나은 방법
            </p>
            <p className={styles.heroDescription}>
              업무 관리부터 협업까지,
              <br />모든 팀의 성장을 지원합니다.
            </p>

            <div className={styles.illustrationWrap} aria-hidden="true">
              <img
                src={getAuthIllustrationUrl('signup', themeMode)}
                alt=""
                draggable={false}
                className={styles.illustration}
              />
            </div>

            <ul className={styles.featureRow} aria-label="Axis 주요 특징">
              <li className={styles.featureItem}>
                <span className={`${styles.featureIcon} ${styles.featureIconPurple}`}>
                  <Icon name="users" size={24} />
                </span>
                <span>팀 협업 효율 향상</span>
              </li>
              <li className={styles.featureItem}>
                <span className={`${styles.featureIcon} ${styles.featureIconGreen}`}>
                  <Icon name="checkSquare" size={23} />
                </span>
                <span>업무 진행 상황 관리</span>
              </li>
              <li className={styles.featureItem}>
                <span className={`${styles.featureIcon} ${styles.featureIconBlue}`}>
                  <Icon name="lineChart" size={24} />
                </span>
                <span>데이터 기반 의사결정</span>
              </li>
            </ul>
          </aside>

          <section className={styles.signupCard} aria-labelledby="signup-heading">
            <header className={styles.cardHeader}>
              <h1 id="signup-heading">회원가입</h1>
              <p>
                이메일 인증을 마친 뒤
                <br />회원 정보를 입력해 주세요.
              </p>
            </header>

            <form className={styles.form} onSubmit={handleSubmit} aria-busy={isBusy} noValidate>
              <div className={styles.field}>
                <label htmlFor="signup-email" className={styles.label}>
                  이메일
                </label>
                <div
                  className={[
                    styles.inputShell,
                    errorField === 'email' || errorField === 'all' ? styles.inputShellError : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <Icon name="mail" size={21} className={styles.fieldIcon} aria-hidden="true" />
                  <input
                    id="signup-email"
                    type="email"
                    autoComplete="email"
                    required
                    disabled={isBusy || verificationStage !== 'email'}
                    maxLength={100}
                    value={form.email}
                    onChange={(event) => {
                      setFeedback(null)
                      setErrorField(null)
                      setForm((current) => ({ ...current, email: event.target.value }))
                      if (verificationStage !== 'email') {
                        resetVerification()
                      }
                    }}
                    className={`${styles.input} ${styles.inputWithAction}`}
                    placeholder="이메일 주소를 입력하세요"
                  />
                  {verificationStage === 'email' ? (
                    <button
                      type="button"
                      className={styles.inputActionButton}
                      onClick={handleRequestCode}
                      disabled={isBusy}
                    >
                      {requestingCode ? '전송 중...' : '인증번호 받기'}
                    </button>
                  ) : null}
                </div>

                {verificationStage === 'verified' ? (
                  <div className={styles.verificationSuccess}>
                    <Icon name="checkCircle" size={17} aria-hidden="true" />
                    <span>이메일 인증이 완료되었습니다.</span>
                    <button type="button" className={styles.inlineLinkButton} onClick={resetVerification} disabled={isBusy}>
                      이메일 변경
                    </button>
                  </div>
                ) : null}
              </div>

              {verificationStage === 'code' ? (
                <div className={styles.field}>
                  <label htmlFor="signup-code" className={styles.label}>
                    인증번호
                  </label>
                  <div
                    className={[
                      styles.inputShell,
                      errorField === 'code' || errorField === 'all' ? styles.inputShellError : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <Icon name="checkCircle" size={21} className={styles.fieldIcon} aria-hidden="true" />
                    <input
                      ref={codeInputRef}
                      id="signup-code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      required
                      disabled={isBusy}
                      maxLength={6}
                      value={verificationCode}
                      onChange={(event) => {
                        setFeedback(null)
                        setErrorField(null)
                        setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                      }}
                      className={`${styles.input} ${styles.inputWithAction}`}
                      placeholder="6자리 인증번호"
                    />
                    <button
                      type="button"
                      className={styles.inputActionButton}
                      onClick={handleConfirmCode}
                      disabled={isBusy}
                    >
                      {confirmingCode ? '확인 중...' : '확인'}
                    </button>
                  </div>
                  <div className={styles.verificationMeta}>
                    <span>메일이 오지 않았나요?</span>
                    <button
                      type="button"
                      className={styles.inlineLinkButton}
                      onClick={handleRequestCode}
                      disabled={isBusy || resendCooldown > 0}
                    >
                      {resendCooldown > 0 ? `재전송 (${resendCooldown}초)` : '인증번호 재전송'}
                    </button>
                    <button type="button" className={styles.inlineLinkButton} onClick={resetVerification} disabled={isBusy}>
                      이메일 변경
                    </button>
                  </div>
                </div>
              ) : null}

              <div className={styles.field}>
                <label htmlFor="signup-userid" className={styles.label}>
                  아이디
                </label>
                <div
                  className={[
                    styles.inputShell,
                    errorField === 'userId' || errorField === 'all' ? styles.inputShellError : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <Icon name="user" size={21} className={styles.fieldIcon} aria-hidden="true" />
                  <input
                    id="signup-userid"
                    autoComplete="username"
                    required
                    disabled={!canEditDetails}
                    maxLength={30}
                    value={form.userId}
                    onChange={(event) => {
                      setFeedback(null)
                      setErrorField(null)
                      setForm((current) => ({ ...current, userId: event.target.value }))
                    }}
                    className={styles.input}
                    placeholder="사용자 아이디를 입력하세요"
                  />
                </div>
              </div>

              <div className={styles.field}>
                <label htmlFor="signup-name" className={styles.label}>
                  닉네임
                </label>
                <div
                  className={[
                    styles.inputShell,
                    errorField === 'name' || errorField === 'all' ? styles.inputShellError : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <Icon name="user" size={21} className={styles.fieldIcon} aria-hidden="true" />
                  <input
                    id="signup-name"
                    autoComplete="name"
                    required
                    disabled={!canEditDetails}
                    maxLength={50}
                    value={form.name}
                    onChange={(event) => {
                      setFeedback(null)
                      setErrorField(null)
                      setForm((current) => ({ ...current, name: event.target.value }))
                    }}
                    className={styles.input}
                    placeholder="사용할 닉네임을 입력하세요"
                  />
                </div>
              </div>

              <div className={styles.field}>
                <label htmlFor="signup-password" className={styles.label}>
                  비밀번호
                </label>
                <div
                  className={[
                    styles.inputShell,
                    errorField === 'password' || errorField === 'all' ? styles.inputShellError : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <Icon name="lock" size={21} className={styles.fieldIcon} aria-hidden="true" />
                  <input
                    id="signup-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    disabled={!canEditDetails}
                    maxLength={64}
                    value={form.password}
                    onChange={(event) => {
                      setFeedback(null)
                      setErrorField(null)
                      setForm((current) => ({ ...current, password: event.target.value }))
                    }}
                    className={`${styles.input} ${styles.passwordInput}`}
                    placeholder="비밀번호를 입력하세요"
                    aria-describedby="signup-password-guidance"
                  />
                  <button
                    type="button"
                    className={styles.passwordToggle}
                    onClick={() => setShowPassword((current) => !current)}
                    disabled={!canEditDetails}
                    aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 표시'}
                    aria-pressed={showPassword}
                  >
                    <Icon name={showPassword ? 'eyeOff' : 'eye'} size={21} aria-hidden="true" />
                  </button>
                </div>

                <ul id="signup-password-guidance" className={styles.passwordGuidance}>
                  <li>8자 이상이어야 합니다.</li>
                  <li>영문, 숫자, 특수문자를 모두 포함해야 합니다.</li>
                  <li>다른 서비스와 다른 안전한 비밀번호를 사용하세요.</li>
                </ul>
              </div>

              {feedback ? (
                <div id="signup-feedback" className={styles.feedback} role="alert">
                  {feedback.message}
                </div>
              ) : null}

              <button type="submit" className={styles.primaryButton} disabled={!canEditDetails || submitting}>
                {submitting
                  ? '가입 중...'
                  : verificationStage === 'verified'
                    ? '회원가입'
                    : '이메일 인증을 완료해 주세요'}
              </button>
            </form>

            <div className={styles.divider} aria-hidden="true">
              <span />
              <b>또는</b>
              <span />
            </div>

            <div className={styles.accountActions}>
              <span>이미 계정이 있으신가요?</span>
              <Link
                to="/login"
                className={`${styles.textLink} ${submitting ? styles.disabledLink : ''}`.trim()}
                aria-disabled={submitting || undefined}
                tabIndex={submitting ? -1 : undefined}
                onClick={(event) => {
                  if (submitting) {
                    event.preventDefault()
                  }
                }}
              >
                로그인
              </Link>
            </div>
          </section>
        </div>

        <footer className={styles.footer}>
          <span>© 2026 Axis. All rights reserved.</span>
          <span className={styles.footerDivider} aria-hidden="true" />
          <span>이용약관</span>
          <span className={styles.footerDivider} aria-hidden="true" />
          <span>개인정보처리방침</span>
        </footer>
      </section>
    </main>
  )
}
