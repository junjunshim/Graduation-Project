import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { WindowTitleBar } from '../../../app/chrome/WindowTitleBar'
import { hasCustomWindowControls } from '../../../app/chrome/windowControls'
import { useBodyScrollSurface } from '../../../app/chrome/useBodyScrollSurface'
import axisLogoDarkUrl from '../../../design-system/assets/axis-logo-dark.png'
import axisLogoLightUrl from '../../../design-system/assets/axis-logo-light.png'
import { Icon } from '../../../design-system/primitives/Icon'
import { ThemeToggle } from '../../../design-system/theme/ThemeToggle'
import { isMockDataSource } from '../../workspace/data/workspaceMode'
import { enterDemoWorkspace, getCurrentUser, signIn } from '../api'
import styles from './LoginPage.module.css'

const REMEMBERED_EMAIL_KEY = 'axis-remembered-login-email'

type Feedback = {
  tone: 'error' | 'info'
  message: string
}

function readRememberedEmail() {
  if (typeof window === 'undefined') {
    return ''
  }

  return window.localStorage.getItem(REMEMBERED_EMAIL_KEY) ?? ''
}

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const currentUser = getCurrentUser()
  const isMockMode = isMockDataSource()
  const hasCustomTitleBar = hasCustomWindowControls()
  const rememberedEmail = readRememberedEmail()
  const [form, setForm] = useState({ email: rememberedEmail, password: '' })
  const [rememberEmail, setRememberEmail] = useState(Boolean(rememberedEmail))
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [syncPhase, setSyncPhase] = useState<'auth' | 'ws' | 'sync' | 'parse'>('auth')
  const [feedback, setFeedback] = useState<Feedback | null>(() => {
    const state = location.state

    return state &&
      typeof state === 'object' &&
      'notice' in state &&
      typeof state.notice === 'string'
      ? { tone: 'info', message: state.notice }
      : null
  })

  useBodyScrollSurface(hasCustomTitleBar ? 'auth' : undefined)

  if (currentUser) {
    return <Navigate to="/dashboard" replace />
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (submitting) {
      return
    }

    setSubmitting(true)
    setSyncPhase('auth')
    setFeedback(null)

    try {
      // 1. 사용자 계정 인증
      setSyncPhase('auth')
      const response = await signIn({
        email: form.email,
        password: form.password,
      })

      if (response.status === 'error') {
        setFeedback({ tone: 'error', message: response.message })
        return
      }

      // 2. 실시간 알림 채널(WebSocket) 연결
      setSyncPhase('ws')

      // 3. 워크스페이스 데이터 초기 동기화
      setSyncPhase('sync')

      // 4. 워크스페이스 데이터 준비 완료
      setSyncPhase('parse')

      if (rememberEmail) {
        window.localStorage.setItem(REMEMBERED_EMAIL_KEY, form.email.trim())
      } else {
        window.localStorage.removeItem(REMEMBERED_EMAIL_KEY)
      }

      navigate('/dashboard', { replace: true })
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : '로그인 및 데이터 동기화에 실패했습니다.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  function handleDemoEnter() {
    const response = enterDemoWorkspace()

    if (response.status === 'error') {
      setFeedback({ tone: 'error', message: '데모 환경에 접속하지 못했습니다. 잠시 후 다시 시도해 주세요.' })
      return
    }

    navigate('/dashboard', { replace: true })
  }

  function handlePasswordHelp() {
    setFeedback({ tone: 'info', message: '비밀번호 재설정은 워크스페이스 관리자에게 문의해 주세요.' })
  }

  return (
    <main className={[styles.page, hasCustomTitleBar ? styles.pageWithCustomChrome : ''].filter(Boolean).join(' ')}>
      {hasCustomTitleBar ? (
        <div className={styles.titleBarSlot}>
          <WindowTitleBar variant="auth" />
        </div>
      ) : null}

      <div className={styles.surface}>
        {/* 로그인 및 초기 데이터 동기화 로딩 오버레이 */}
        {submitting ? (
          <div className={styles.loadingOverlay} role="status" aria-live="polite">
            <div className={styles.loadingModal}>
              <div className={styles.spinner} aria-hidden="true" />
              <h3 className={styles.loadingTitle}>
                {syncPhase === 'auth'
                  ? '사용자 인증 중...'
                  : syncPhase === 'ws'
                  ? '실시간 알림 채널 연결 중...'
                  : syncPhase === 'sync'
                  ? '데이터 동기화 중...'
                  : '워크스페이스 준비 중...'}
              </h3>
              <p className={styles.loadingMessage}>
                {syncPhase === 'auth'
                  ? '서버와 안전하게 계정 정보를 확인하고 있습니다.'
                  : syncPhase === 'ws'
                  ? '실시간 업데이트 및 알림 소켓을 연결하고 있습니다.'
                  : syncPhase === 'sync'
                  ? '조직 구조 및 권한 데이터를 불러오고 있습니다.'
                  : '대시보드와 작업 공간을 구성하고 있습니다.'}
              </p>
            </div>
          </div>
        ) : null}

        <div className={styles.backgroundDecor} aria-hidden="true">
          <span className={styles.topGlow} />
          <span className={styles.waveBack} />
          <span className={styles.waveFront} />
          <span className={[styles.decorDot, styles.dotOne].join(' ')} />
          <span className={[styles.decorDot, styles.dotTwo].join(' ')} />
          <span className={[styles.decorDot, styles.dotThree].join(' ')} />
        </div>

        <header className={styles.utilityBar}>
          <div className={styles.utilityActions}>
            {!hasCustomTitleBar ? <ThemeToggle compact /> : null}
            <div className={styles.languageChip}>
              <Icon name="globe" size={20} />
              <span lang="ko">한국어</span>
            </div>
          </div>
        </header>

        <div className={styles.content}>
          <section className={styles.brandPanel} aria-labelledby="login-hero-title">
            <span className={styles.axisBrand} role="img" aria-label="Axis">
              <img
                src={axisLogoLightUrl}
                alt=""
                aria-hidden="true"
                draggable={false}
                className={`${styles.axisLogo} ${styles.axisLogoLight}`}
              />
              <img
                src={axisLogoDarkUrl}
                alt=""
                aria-hidden="true"
                draggable={false}
                className={`${styles.axisLogo} ${styles.axisLogoDark}`}
              />
            </span>

            <h1 id="login-hero-title" className={styles.heroTitle}>
              당신의 업무를
              <br />
              더 쉽게, <span>함께</span>
            </h1>
            <p className={styles.heroDescription}>
              Axis와 함께 아이디어를 실현하고
              <br />
              팀의 성과를 만들어보세요.
            </p>

            <div className={styles.illustrationWrap}>
              <img
                src="./images/axis-workspace-illustration.png"
                alt="업무 카드와 협업 도구가 어우러진 3D 일러스트"
                className={styles.illustration}
                draggable={false}
              />
            </div>
          </section>

          <section className={styles.loginCard} aria-labelledby="login-card-title">
            <div className={styles.cardHeader}>
              <h2 id="login-card-title">다시 만나서 반가워요!</h2>
              <p>Axis 계정으로 로그인해주세요.</p>
            </div>

            <form className={styles.form} onSubmit={handleSubmit} aria-busy={submitting}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="login-email">
                  이메일
                </label>
                <span className={styles.inputShell}>
                  <Icon name="mail" size={21} className={styles.fieldIcon} />
                  <input
                    id="login-email"
                    type="email"
                    autoComplete="email"
                    required
                    disabled={submitting}
                    value={form.email}
                    onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                    className={styles.input}
                    placeholder="이메일 주소를 입력하세요"
                  />
                </span>
              </div>

              <div className={styles.field}>
                <label className={styles.label} htmlFor="login-password">
                  비밀번호
                </label>
                <span className={styles.inputShell}>
                  <Icon name="lock" size={21} className={styles.fieldIcon} />
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    disabled={submitting}
                    value={form.password}
                    onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
                    className={[styles.input, styles.passwordInput].join(' ')}
                    placeholder="비밀번호를 입력하세요"
                  />
                  <button
                    type="button"
                    className={styles.passwordToggle}
                    aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((current) => !current)}
                  >
                    <Icon name={showPassword ? 'eyeOff' : 'eye'} size={22} />
                  </button>
                </span>
              </div>

              <div className={styles.optionsRow}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={rememberEmail}
                    onChange={(event) => setRememberEmail(event.target.checked)}
                  />
                  <span className={styles.customCheckbox} aria-hidden="true" />
                  <span>이메일 기억하기</span>
                </label>
                <button type="button" className={styles.textButton} onClick={handlePasswordHelp}>
                  비밀번호 찾기
                </button>
              </div>

              {feedback ? (
                <div
                  className={[styles.feedback, feedback.tone === 'error' ? styles.feedbackError : styles.feedbackInfo].join(
                    ' ',
                  )}
                  role={feedback.tone === 'error' ? 'alert' : 'status'}
                >
                  {feedback.message}
                </div>
              ) : null}

              <button type="submit" className={styles.primaryButton} disabled={submitting}>
                {submitting ? '로그인 중...' : '로그인'}
              </button>
            </form>

            <div className={styles.divider} aria-hidden="true">
              <span />
              <b>또는</b>
              <span />
            </div>

            <div className={styles.secondaryActions}>
              {isMockMode ? (
                <>
                  <button type="button" className={styles.secondaryLink} onClick={handleDemoEnter}>
                    데모로 둘러보기
                  </button>
                  <span aria-hidden="true">·</span>
                </>
              ) : null}
              <Link to="/signup" className={styles.secondaryLink}>
                회원가입
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
      </div>
    </main>
  )
}
