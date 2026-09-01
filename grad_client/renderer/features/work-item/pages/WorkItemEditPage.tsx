import { type FormEvent, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getCurrentUser } from '../../auth/api'
import { getOrgSnapshot } from '../../workspace/data/orgService'
import { claimWorkItem, updateWorkItem } from '../../workspace/data/workItemService'
import { isServerDataSource } from '../../workspace/data/workspaceMode'
import type { WorkItemRecord } from '../../workspace/model/types'
import { getWorkItemTag } from '../../workspace/model/workItemTags'
import { getSelectedWorkItemDetail } from '../../workspace/queries/selectedWorkItemDetail'
import { getWorkItemComposerContext } from '../../workspace/queries/workItemComposer'
import { WorkItemCreateForm } from '../components/WorkItemCreateForm'
import type { WorkItemCreateFormState } from '../hooks/useWorkItemCreateForm'
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
  const [initialForm] = useState<WorkItemCreateFormState>(() => createInitialForm(detail?.item))
  const [form, setForm] = useState<WorkItemCreateFormState>(initialForm)
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
  const isServerMode = isServerDataSource()

  function setField<Key extends keyof WorkItemCreateFormState>(
    field: Key,
    value: WorkItemCreateFormState[Key],
  ) {
    setForm((current) => ({ ...current, [field]: value }))
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (submitting) {
      return
    }

    setSubmitting(true)
    setFeedback(null)

    if (!form.title.trim()) {
      setSubmitting(false)
      setFeedback({ tone: 'error', message: '업무 제목을 입력해 주세요.' })
      return
    }

    const dateRangeError = getWorkItemDateRangeError(form.startDate, form.dueDate)

    if (dateRangeError) {
      setSubmitting(false)
      setFeedback({ tone: 'error', message: dateRangeError })
      return
    }

    try {
      if (form.ownerUserId !== item.ownerUserId) {
        const claimResponse = await claimWorkItem({
          workItemId: item.workItemId,
          ownerUserId: form.ownerUserId,
        })

        if (claimResponse.status === 'error') {
          setFeedback({ tone: 'error', message: claimResponse.message })
          return
        }
      }

      const response = await updateWorkItem(
        createWorkItemUpdatePayload(item.workItemId, initialForm, form),
      )

      if (response.status === 'error') {
        setFeedback({ tone: 'error', message: response.message })
        return
      }

      navigate(`/work-items/${item.workItemId}`)
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : '업무를 수정하지 못했습니다.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className={styles.page}>
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
  )
}
