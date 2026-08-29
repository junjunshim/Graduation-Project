import { type FormEvent, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getCurrentUser } from '../../auth/api'
import { getOrgSnapshot } from '../../workspace/data/orgService'
import { claimWorkItem, updateWorkItem } from '../../workspace/data/workItemService'
import type { WorkItemRecord } from '../../workspace/model/types'
import { getWorkItemTag } from '../../workspace/model/workItemTags'
import { getSelectedWorkItemDetail } from '../../workspace/queries/selectedWorkItemDetail'
import { getWorkItemComposerContext } from '../../workspace/queries/workItemComposer'
import { WorkItemCreateForm } from '../components/WorkItemCreateForm'
import type { WorkItemCreateFormState } from '../hooks/useWorkItemCreateForm'
import createPageStyles from '../styles/WorkItemCreatePage.module.css'
import styles from './WorkItemEditPage.module.css'

function createInitialForm(item?: WorkItemRecord): WorkItemCreateFormState {
  return {
    categoryId: item ? getWorkItemTag(item)?.id ?? '' : '',
    ownerNodeId: item ? String(item.ownerNodeId) : '',
    ownerUserId: item?.ownerUserId ?? '',
    title: item?.title ?? '',
    parentWorkItemId: item?.parentWorkItemId ?? '',
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
  const detail =
    currentUser && workItemId
      ? getSelectedWorkItemDetail(workItemId, currentUser.userId, snapshot)
      : null
  const [form, setForm] = useState<WorkItemCreateFormState>(() => createInitialForm(detail?.item))
  const [submitting, setSubmitting] = useState(false)
  const [feedback, setFeedback] = useState<{ tone: 'error' | 'success'; message: string } | null>(null)

  if (!currentUser) {
    return null
  }

  if (!detail) {
    return (
      <section className={styles.page}>
        <div className={styles.emptyState}>
          <h2 className={styles.title}>수정할 업무를 찾을 수 없습니다.</h2>
          <p className={styles.description}>
            요청한 업무가 없거나 현재 계정으로 접근할 수 없는 항목입니다.
          </p>
          <Link to="/work-items" className={styles.primaryAction}>업무 목록으로 돌아가기</Link>
        </div>
      </section>
    )
  }

  const { item } = detail
  const composer = getWorkItemComposerContext(currentUser.userId, item.ownerNodeId, snapshot)

  function setField<Key extends keyof WorkItemCreateFormState>(
    field: Key,
    value: WorkItemCreateFormState[Key],
  ) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setFeedback(null)

    if (form.ownerUserId !== item.ownerUserId) {
      const claimResponse = await claimWorkItem({
        workItemId: item.workItemId,
        ownerUserId: form.ownerUserId,
      })

      if (claimResponse.status === 'error') {
        setSubmitting(false)
        setFeedback({ tone: 'error', message: claimResponse.message })
        return
      }
    }

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
      setFeedback({ tone: 'error', message: response.message })
      return
    }

    navigate(`/work-items/${item.workItemId}`)
  }

  return (
    <section className={styles.page}>
      <div className={`${createPageStyles.page} ${createPageStyles.pageEmbedded}`}>
        <div className={`${createPageStyles.layout} ${createPageStyles.layoutEmbedded}`}>
          <section className={`${createPageStyles.editorPanel} ${createPageStyles.editorPanelEmbedded}`}>
            <WorkItemCreateForm
              composer={composer}
              form={form}
              submitting={submitting}
              feedback={feedback}
              onSubmit={handleSubmit}
              onCancel={() => navigate(`/work-items/${item.workItemId}`)}
              onFieldChange={setField}
              submitLabel="저장"
              submittingLabel="저장 중..."
            />
          </section>
        </div>
      </div>
    </section>
  )
}
