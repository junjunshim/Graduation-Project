import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { WindowTitleBar } from '../../../app/chrome/WindowTitleBar'
import { hasCustomWindowControls } from '../../../app/chrome/windowControls'
import { useBodyScrollSurface } from '../../../app/chrome/useBodyScrollSurface'
import axisLogoDarkUrl from '../../../design-system/assets/axis-logo-dark.png'
import axisLogoLightUrl from '../../../design-system/assets/axis-logo-light.png'
import { Icon } from '../../../design-system/primitives/Icon'
import { ThemeToggle } from '../../../design-system/theme/ThemeToggle'
import { isMockDataSource } from '../../workspace/data/workspaceMode'
import signupHeroUrl from '../assets/signup-collaboration-hero.png'
import { enterDemoWorkspace, getCurrentUser, getSuggestedUserId, signUp } from '../api'
import styles from './SignupPage.module.css'

const initialForm = {
  email: '',
  name: '',
  password: '',
}

type Feedback = {
  message: string
}

export function SignupPage() {
  const navigate = useNavigate()
  const currentUser = getCurrentUser()
  const isMockMode = isMockDataSource()
  const suggestedUserId = useMemo(() => getSuggestedUserId(), [])
  const hasCustomTitleBar = hasCustomWindowControls()
  const [form, setForm] = useState(initialForm)
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const mountedRef = useRef(true)

  useBodyScrollSurface(hasCustomTitleBar ? 'auth' : undefined)

  useEffect(() => {
    mountedRef.current = true

    return () => {
      mountedRef.current = false
    }
  }, [])

  if (currentUser) {
    return <Navigate to="/dashboard" replace />
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (submitting) {
      return
    }

    setFeedback(null)

    if (!form.email.trim() || !form.name.trim() || !form.password.trim()) {
      setFeedback({ message: '필수 정보를 모두 입력해 주세요.' })
      return
    }

    setSubmitting(true)

    try {
      const response = await signUp({
        userId: suggestedUserId,
        email: form.email,
        name: form.name,
        password: form.password,
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

        setFeedback({ message: response.message || '가입 정보를 다시 확인해 주세요.' })
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

  function handleDemoEnter() {
    if (submitting) {
      return
    }

    setFeedback(null)
    const response = enterDemoWorkspace()

    if (response.status === 'error') {
      setFeedback({ message: response.message || '데모 환경에 접속하지 못했습니다.' })
      return
    }

    navigate('/dashboard', { replace: true })
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

        {!hasCustomTitleBar ? (
          <header className={styles.utilityBar}>
            <ThemeToggle compact />
          </header>
        ) : null}

        <div className={styles.content}>
          <aside className={styles.visualPanel} aria-label="Axis 소개">
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

            <p className={styles.heroTitle}>
              함께 일하는
              <br />더 나은 방법, <span>Axis</span>
            </p>
            <p className={styles.heroDescription}>
              업무 관리부터 협업까지,
              <br />모든 팀의 성장을 지원합니다.
            </p>

            <div className={styles.illustrationWrap} aria-hidden="true">
              <img
                src={signupHeroUrl}
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
                Axis 서비스를 이용하기 위해
                <br />회원 정보를 입력해 주세요.
              </p>
            </header>

            <form className={styles.form} onSubmit={handleSubmit} aria-busy={submitting}>
              <div className={styles.field}>
                <label htmlFor="signup-email" className={styles.label}>
                  이메일
                </label>
                <div className={styles.inputShell}>
                  <Icon name="mail" size={21} className={styles.fieldIcon} aria-hidden="true" />
                  <input
                    id="signup-email"
                    type="email"
                    autoComplete="email"
                    required
                    disabled={submitting}
                    value={form.email}
                    onChange={(event) => {
                      setFeedback(null)
                      setForm((current) => ({ ...current, email: event.target.value }))
                    }}
                    className={styles.input}
                    placeholder="이메일 주소를 입력하세요"
                  />
                </div>
              </div>

              <div className={styles.field}>
                <label htmlFor="signup-name" className={styles.label}>
                  닉네임
                </label>
                <div className={styles.inputShell}>
                  <Icon name="user" size={21} className={styles.fieldIcon} aria-hidden="true" />
                  <input
                    id="signup-name"
                    autoComplete="name"
                    required
                    disabled={submitting}
                    value={form.name}
                    onChange={(event) => {
                      setFeedback(null)
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
                <div className={styles.inputShell}>
                  <Icon name="lock" size={21} className={styles.fieldIcon} aria-hidden="true" />
                  <input
                    id="signup-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    disabled={submitting}
                    value={form.password}
                    onChange={(event) => {
                      setFeedback(null)
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
                    disabled={submitting}
                    aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 표시'}
                    aria-pressed={showPassword}
                  >
                    <Icon name={showPassword ? 'eyeOff' : 'eye'} size={21} aria-hidden="true" />
                  </button>
                </div>

                <ul id="signup-password-guidance" className={styles.passwordGuidance}>
                  <li>보안을 위해 8자 이상을 권장합니다.</li>
                  <li>영문, 숫자, 특수문자 조합을 권장합니다.</li>
                  <li>다른 서비스와 다른 비밀번호를 사용하세요.</li>
                </ul>
              </div>

              {feedback ? (
                <div id="signup-feedback" className={styles.feedback} role="alert">
                  {feedback.message}
                </div>
              ) : null}

              <button type="submit" className={styles.primaryButton} disabled={submitting}>
                {submitting ? '가입 중...' : '회원가입'}
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
              {isMockMode ? (
                <>
                  <span className={styles.actionDivider} aria-hidden="true">
                    ·
                  </span>
                  <button
                    type="button"
                    className={styles.demoButton}
                    onClick={handleDemoEnter}
                    disabled={submitting}
                  >
                    데모로 둘러보기
                  </button>
                </>
              ) : null}
            </div>
          </section>
        </div>
      </section>
    </main>
  )
}
