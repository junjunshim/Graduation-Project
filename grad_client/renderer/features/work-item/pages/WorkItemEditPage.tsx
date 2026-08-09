import { type FormEvent, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getCurrentUser } from '../../auth/api'
import { getOrgSnapshot } from '../../workspace/data/orgService'
import { updateWorkItem } from '../../workspace/data/workItemService'
import { getSelectedWorkItemDetail } from '../../workspace/queries/selectedWorkItemDetail'
import { formatWorkspaceDate } from '../../workspace/model/formatters'
import { getNodeTypeLabel, getWorkItemStatusLabel } from '../../workspace/model/labels'
import { WORK_ITEM_STATUS_OPTIONS } from '../../workspace/model/options'
import type { WorkItemRecord, WorkItemStatus } from '../../workspace/model/types'
import styles from './WorkItemEditPage.module.css'

function createInitialForm(item?: WorkItemRecord) {
  return {
    title: item?.title ?? '',
    description: item?.description ?? '',
    status: item?.status ?? 'todo',
    priority: String(item?.priority ?? 3),
    weight: String(item?.weight ?? 1),
    progress: String(item?.progress ?? 0),
    startDate: item?.startDate ?? '',
    dueDate: item?.dueDate ?? '',
  }
}

export function WorkItemEditPage() {
  const navigate = useNavigate()
  const snapshot = getOrgSnapshot()
  const currentUser = getCurrentUser(snapshot)
  const { workItemId } = useParams()
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ tone: 'error' | 'success'; message: string } | null>(null)
  const detail =
    currentUser && workItemId
      ? getSelectedWorkItemDetail(workItemId, currentUser.userId, snapshot)
      : null
  const [form, setForm] = useState(() => createInitialForm(detail?.item))

  if (!currentUser) {
    return null
  }

  if (!detail) {
    return (
      <section className={styles.page}>
        <div className={styles.emptyState}>
          <p className={styles.eyebrow}>Work Item Edit</p>
          <h2 className={styles.title}>수정할 업무를 찾을 수 없습니다.</h2>
          <p className={styles.description}>
            요청한 업무가 없거나 접근할 수 없는 항목입니다. 상세 페이지로 이동 가능한 업무만 수정 진입이 가능합니다.
          </p>
          <Link to="/dashboard" className={styles.primaryAction}>
            대시보드로 돌아가기
          </Link>
        </div>
      </section>
    )
  }

  const { item, ownerNode, ownerUser } = detail

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setFeedback(null)

    const response = await updateWorkItem({
      workItemId: item.workItemId,
      title: form.title,
      description: form.description,
      status: form.status,
      priority: Number(form.priority),
      weight: Number(form.weight),
      progress: Number(form.progress),
      startDate: form.startDate,
      dueDate: form.dueDate,
    })

    setSubmitting(false)

    if (response.status === 'error') {
      setFeedback({
        tone: 'error',
        message: response.message,
      })
      return
    }

    setFeedback({
      tone: 'success',
      message: '업무가 수정되었습니다.',
    })
    navigate(`/work-items/${item.workItemId}`)
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Work Item Edit</p>
          <h2 className={styles.title}>{item.title} 수정</h2>
          <p className={styles.description}>제목, 설명, 상태, 일정과 진행값을 수정하고 상세 화면으로 돌아갑니다.</p>
        </div>

        <div className={styles.actions}>
          <Link to={`/work-items/${item.workItemId}`} className={styles.primaryAction}>
            상세로 돌아가기
          </Link>
          <Link to="/work-items/new" className={styles.secondaryAction}>
            새 업무 등록
          </Link>
        </div>
      </header>

      <div className={styles.layout}>
        <section className={styles.panel}>
          <div>
            <p className={styles.panelEyebrow}>Current Context</p>
            <h3 className={styles.panelTitle}>현재 업무 컨텍스트</h3>
          </div>

          <dl className={styles.contextList}>
            <div className={styles.contextRow}>
              <dt>ID</dt>
              <dd>{item.workItemId}</dd>
            </div>
            <div className={styles.contextRow}>
              <dt>상태</dt>
              <dd>{getWorkItemStatusLabel(item.status)}</dd>
            </div>
            <div className={styles.contextRow}>
              <dt>진행률</dt>
              <dd>{item.progress}%</dd>
            </div>
            <div className={styles.contextRow}>
              <dt>담당자</dt>
              <dd>
                {ownerUser.name} ({ownerUser.userId})
              </dd>
            </div>
            <div className={styles.contextRow}>
              <dt>소유 조직</dt>
              <dd>
                {ownerNode.name}
                <span className={styles.contextSubtext}>{getNodeTypeLabel(ownerNode.nodeType)}</span>
              </dd>
            </div>
            <div className={styles.contextRow}>
              <dt>일정</dt>
              <dd>
                시작 {formatWorkspaceDate(item.startDate)} · 마감 {formatWorkspaceDate(item.dueDate)}
              </dd>
            </div>
          </dl>
        </section>

        <form className={styles.panel} onSubmit={handleSubmit}>
          <div>
            <p className={styles.panelEyebrow}>Edit Form</p>
            <h3 className={styles.panelTitle}>업무 속성 수정</h3>
          </div>

          <label className={styles.field}>
            <span className={styles.label}>업무 제목</span>
            <input
              className={styles.input}
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              required
            />
          </label>

          <label className={styles.field}>
            <span className={styles.label}>설명</span>
            <textarea
              className={styles.textarea}
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
            />
          </label>

          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span className={styles.label}>상태</span>
              <select
                className={styles.input}
                value={form.status}
                onChange={(event) =>
                  setForm((current) => ({ ...current, status: event.target.value as WorkItemStatus }))
                }
              >
                {WORK_ITEM_STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {getWorkItemStatusLabel(status)}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.label}>우선순위</span>
              <input
                type="number"
                min={1}
                max={5}
                className={styles.input}
                value={form.priority}
                onChange={(event) => setForm((current) => ({ ...current, priority: event.target.value }))}
              />
            </label>
          </div>

          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span className={styles.label}>가중치</span>
              <input
                type="number"
                min={0}
                className={styles.input}
                value={form.weight}
                onChange={(event) => setForm((current) => ({ ...current, weight: event.target.value }))}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>진행률</span>
              <input
                type="number"
                min={0}
                max={100}
                className={styles.input}
                value={form.progress}
                onChange={(event) => setForm((current) => ({ ...current, progress: event.target.value }))}
              />
            </label>
          </div>

          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span className={styles.label}>시작일</span>
              <input
                type="date"
                className={styles.input}
                value={form.startDate}
                onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>마감일</span>
              <input
                type="date"
                className={styles.input}
                value={form.dueDate}
                onChange={(event) => setForm((current) => ({ ...current, dueDate: event.target.value }))}
              />
            </label>
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

          <div className={styles.actions}>
            <button type="submit" className={styles.primaryAction} disabled={submitting}>
              {submitting ? '저장 중...' : '수정 저장'}
            </button>
            <Link to={`/work-items/${item.workItemId}`} className={styles.secondaryAction}>
              취소
            </Link>
          </div>
        </form>
      </div>
    </section>
  )
}
