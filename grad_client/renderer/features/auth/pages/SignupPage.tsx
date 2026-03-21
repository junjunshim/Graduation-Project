import { useMemo, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { enterDemoWorkspace, getCurrentUser, getSuggestedUserId, signUp } from '../api'
import { AuthPageLayout } from '../components/AuthPageLayout'
import styles from '../components/AuthPageLayout.module.css'

const authSteps = [
  {
    number: '01',
    title: '계정 만들기',
    description: '이메일과 이름을 입력해 계정을 생성합니다.',
  },
  {
    number: '02',
    title: '공간 준비',
    description: '가입과 동시에 개인 워크스페이스가 생성됩니다.',
  },
  {
    number: '03',
    title: '업무 시작',
    description: '조직을 만들고 업무를 등록해 바로 운영할 수 있습니다.',
  },
]

const initialForm = {
  email: '',
  name: '',
  password: '',
}

export function SignupPage() {
  const navigate = useNavigate()
  const currentUser = getCurrentUser()
  const suggestedUserId = useMemo(() => getSuggestedUserId(), [])
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

    if (!form.email.trim() || !form.name.trim() || !form.password.trim()) {
      setSubmitting(false)
      setFeedback({
        tone: 'error',
        message: '필수 정보를 모두 입력해 주세요.',
      })
      return
    }

    const response = await signUp({
      userId: suggestedUserId,
      email: form.email,
      name: form.name,
      password: form.password,
    })

    setSubmitting(false)

    if (response.status === 'error') {
      setFeedback({
        tone: 'error',
        message: '가입 정보를 다시 확인해 주세요.',
      })
      return
    }

    navigate('/dashboard', { replace: true })
  }

  function handleDemoEnter() {
    const response = enterDemoWorkspace()

    if (response.status === 'error') {
      setFeedback({
        tone: 'error',
        message: '데모 환경에 접속하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      })
      return
    }

    navigate('/dashboard', { replace: true })
  }

  return (
    <AuthPageLayout
      heroEyebrow="회원가입"
      heroTitle="계정을 만들고 워크스페이스를 시작하세요."
      heroDescription="가입이 완료되면 개인 워크스페이스가 함께 만들어지며 바로 서비스를 사용할 수 있습니다."
      steps={authSteps}
      formEyebrow="계정 등록"
      formTitle="새 계정 만들기"
      formText={
        <>
          이번 가입에 사용할 사용자 ID는 <strong>{suggestedUserId}</strong>입니다.
          <div className={styles.linkRow}>
            <span>이미 계정이 있으신가요?</span>
            <Link to="/login" className={styles.textLink}>
              로그인
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
            <span className={styles.label}>이름</span>
            <input
              autoComplete="name"
              required
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
              className={styles.input}
              placeholder="이름을 입력해 주세요"
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>비밀번호</span>
            <input
              type="password"
              autoComplete="new-password"
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
            {submitting ? '가입 중...' : '회원가입'}
          </button>
        </form>
      }
      supportEyebrow="데모 체험"
      supportTitle="데모 워크스페이스로 시작하기"
      supportText="가입 없이 서비스 흐름을 먼저 확인하고 싶다면 데모 환경으로 바로 들어갈 수 있습니다."
      supportContent={
        <div className={styles.metaList}>
          <div className={styles.supportCard}>
            <strong>바로 체험</strong>
            <p className={styles.metaText}>데모 계정으로 로그인해 주요 기능을 바로 확인할 수 있습니다.</p>
          </div>
          <button type="button" className={styles.secondaryButton} onClick={handleDemoEnter}>
            데모로 시작하기
          </button>
        </div>
      }
    />
  )
}
