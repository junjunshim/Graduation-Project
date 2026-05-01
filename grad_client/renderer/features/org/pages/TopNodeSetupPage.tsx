import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getCurrentUser } from '../../auth/api'
import { createTopNode } from '../../workspace/data/orgService'
import { ORG_NODE_TYPE_OPTIONS } from '../../workspace/model/options'
import type { NodeType } from '../../workspace/model/types'
import styles from './TopNodeSetupPage.module.css'

const nodeTypeCopy: Record<Exclude<NodeType, 'USER'>, string> = {
  COMPANY: '회사',
  DIVISION: '본부',
  DEPARTMENT: '부서',
  TEAM: '팀',
  PROJECT: '프로젝트',
}

export function TopNodeSetupPage() {
  const navigate = useNavigate()
  const currentUser = getCurrentUser()
  const [nodeType, setNodeType] = useState<Exclude<NodeType, 'USER'>>('COMPANY')
  const [name, setName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ tone: 'error' | 'success'; message: string } | null>(null)

  if (!currentUser) {
    return null
  }

  const user = currentUser

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setFeedback(null)

    if (!name.trim()) {
      setSubmitting(false)
      setFeedback({ tone: 'error', message: '공간 이름을 입력해 주세요.' })
      return
    }

    const response = await createTopNode({
      nodeType,
      name,
      userId: user.userId,
      roleName: 'ADMIN',
    })

    setSubmitting(false)

    if (response.status === 'error') {
      setFeedback({ tone: 'error', message: response.message })
      return
    }

    navigate('/dashboard')
  }

  return (
    <section className={styles.page}>
      <header className={styles.pageIntro}>
        <p className={styles.eyebrow}>New Workspace</p>
        <h2 className={styles.title}>첫 번째 공유 공간을 만들어 주세요.</h2>
        <p className={styles.description}>
          회사, 본부, 팀처럼 함께 사용할 최상위 공간을 등록하면 이후 조직과 업무를 연결할 수 있습니다.
        </p>
      </header>

      <div className={styles.layout}>
        <section className={styles.formPanel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.panelEyebrow}>Properties</p>
              <h3 className={styles.panelTitle}>기본 정보 입력</h3>
            </div>
          </div>

          <form className={styles.form} onSubmit={handleSubmit}>
            <label className={styles.field}>
              <span className={styles.label}>공간 유형</span>
              <select
                value={nodeType}
                onChange={(event) => setNodeType(event.target.value as Exclude<NodeType, 'USER'>)}
                className={styles.input}
              >
                {ORG_NODE_TYPE_OPTIONS.map((type) => (
                  <option key={type} value={type}>
                    {nodeTypeCopy[type]}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.label}>공간 이름</span>
              <input
                className={styles.input}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="예: 404, 무한 확장형 조직 노드 기반 협업 시스템, 프론트엔드"
              />
            </label>

            <div className={styles.callout}>
              <p className={styles.panelEyebrow}>기본 권한</p>
              <strong>ADMIN</strong>
              <p className={styles.calloutText}>공간을 만든 계정은 해당 공간의 관리자 권한을 가집니다.</p>
            </div>

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

            <button type="submit" className={styles.submitButton} disabled={submitting}>
              {submitting ? '공간 만드는 중...' : '공유 공간 만들기'}
            </button>
          </form>
        </section>

        <aside className={styles.sidebar}>
          <section className={styles.sidePanel}>
            <p className={styles.panelEyebrow}>Account</p>
            <h3 className={styles.panelTitle}>등록 계정</h3>
            <strong className={styles.accountName}>{user.name}</strong>
            <p className={styles.accountMeta}>
              {user.userId} · {user.email}
            </p>
          </section>

          <section className={styles.sidePanel}>
            <p className={styles.panelEyebrow}>Guide</p>
            <h3 className={styles.panelTitle}>생성 후 다음 단계</h3>
            <ul className={styles.guideList}>
              <li>하위 조직을 추가해 운영 구조를 나눕니다.</li>
              <li>관리자와 담당자 권한을 배치합니다.</li>
              <li>첫 업무를 생성해 진행 흐름을 시작합니다.</li>
            </ul>
          </section>
        </aside>
      </div>
    </section>
  )
}
