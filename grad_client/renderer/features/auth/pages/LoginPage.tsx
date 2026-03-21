import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { enterDemoWorkspace, getCurrentUser, signIn } from '../api'
import { AuthPageLayout } from '../components/AuthPageLayout'
import styles from '../components/AuthPageLayout.module.css'

const authSteps = [
  {
    number: '01',
    title: '계정 확인',
    description: '등록한 계정으로 로그인해 서비스를 시작합니다.',
  },
  {
    number: '02',
    title: '서비스 입장',
    description: '로그인 후 대시보드와 조직 화면에 바로 들어갑니다.',
  },
  {
    number: '03',
    title: '업무 이어보기',
    description: '중요한 업무와 최근 현황을 바로 확인할 수 있습니다.',
  },
]

const initialForm = {
  email: '',
  password: '',
}

export function LoginPage() {
  const navigate = useNavigate()
  const currentUser = getCurrentUser()
  const [form, setForm] = useState(initialForm)
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ tone: 'error' | 'success'; message: string } | null>(null)

  if (currentUser) {
    return <Navigate to="/dashboard" replace />
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setFeedback(null)

    const response = await signIn({
      email: form.email,
      password: form.password,
    })

    setSubmitting(false)

    if (response.status === 'error') {
      setFeedback({ tone: 'error', message: '이메일 또는 비밀번호를 확인해 주세요.' })
      return
    }

    navigate('/dashboard', { replace: true })
  }

  function handleDemoEnter() {
    const response = enterDemoWorkspace()

    if (response.status === 'error') {
      setFeedback({ tone: 'error', message: '데모 환경에 접속하지 못했습니다. 잠시 후 다시 시도해 주세요.' })
      return
    }

    navigate('/dashboard', { replace: true })
  }

  return (
    <AuthPageLayout
      heroEyebrow="서비스 시작"
      heroTitle="로그인하고 바로 업무를 확인하세요."
      heroDescription="등록한 계정으로 로그인하면 대시보드, 조직 관리, 업무 등록 기능을 바로 이용할 수 있습니다."
      steps={authSteps}
      formEyebrow="로그인"
      formTitle="계정 로그인"
      formText={
        <>
          등록한 이메일과 비밀번호를 입력해 주세요.
          <div className={styles.linkRow}>
            <span>계정이 없으신가요?</span>
            <Link to="/signup" className={styles.textLink}>
              회원가입
            </Link>
          </div>
        </>
      }
      formContent={
        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span className={styles.label}>이메일</span>
            <input
              type="email"
              autoComplete="email"
              required
              value={form.email}
              onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
              className={styles.input}
              placeholder="이메일을 입력해 주세요"
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>비밀번호</span>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={form.password}
              onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
              className={styles.input}
              placeholder="비밀번호를 입력해 주세요"
            />
          </label>

          {feedback ? (
            <div
              className={[
                styles.feedback,
                feedback.tone === 'error' ? styles.feedbackError : styles.feedbackSuccess,
              ].join(' ')}
            >
              {feedback.message}
            </div>
          ) : null}

          <button type="submit" className={styles.primaryButton} disabled={submitting}>
            {submitting ? '로그인 중...' : '로그인'}
          </button>
        </form>
      }
      supportEyebrow="데모 체험"
      supportTitle="데모 워크스페이스로 둘러보기"
      supportText="서비스 흐름만 먼저 확인하고 싶다면 데모 계정으로 바로 시작할 수 있습니다."
      supportContent={
        <div className={styles.metaList}>
          <div className={styles.supportCard}>
            <strong>빠른 체험</strong>
            <p className={styles.metaText}>데모 계정으로 로그인하고 주요 화면을 바로 확인할 수 있습니다.</p>
          </div>
          <button type="button" className={styles.secondaryButton} onClick={handleDemoEnter}>
            데모로 시작하기
          </button>
        </div>
      }
    />
  )
}
