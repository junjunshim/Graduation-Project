import type { FormEvent } from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getCurrentUser } from '../../auth/api'
import { createWorkItem } from '../../workspace/data/workItemService'
import { isServerDataSource } from '../../workspace/data/workspaceMode'
import { WorkItemCreateForm } from '../components/WorkItemCreateForm'
import { WorkItemCreateSidebar } from '../components/WorkItemCreateSidebar'
import { useWorkItemCreateForm } from '../hooks/useWorkItemCreateForm'
import { getWorkItemDateRangeError } from '../model/workItemFormValidation'
import styles from '../styles/WorkItemCreatePage.module.css'

type WorkItemCreatePageProps = {
  embedded?: boolean
}

export function WorkItemCreatePage({ embedded = false }: WorkItemCreatePageProps) {
  const navigate = useNavigate()
  const currentUser = getCurrentUser()
  const [feedback, setFeedback] = useState<{ tone: 'error' | 'success'; message: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const isServerMode = isServerDataSource()
  const { composer, form, setField } = useWorkItemCreateForm(currentUser?.userId)

  if (!currentUser || !composer) {
    return null
  }

  const activeComposer = composer
  const serverAvailabilityMessage = isServerMode
    ? !activeComposer.selectedNode
      ? '업무를 생성할 직접 권한(ADMIN, MANAGER 또는 MEMBER)이 있는 조직이 없습니다.'
      : activeComposer.assignableUsers.length === 0
        ? '선택한 조직에 업무 담당자로 지정할 직접 멤버가 없습니다.'
        : null
    : null

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (submitting) {
      return
    }

    setSubmitting(true)
    setFeedback(null)

    if (serverAvailabilityMessage) {
      setSubmitting(false)
      setFeedback({ tone: 'error', message: serverAvailabilityMessage })
      return
    }

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
      const response = await createWorkItem({
        workItemId: activeComposer.suggestedWorkItemId,
        ownerNodeId: Number(form.ownerNodeId),
        ownerUserId: form.ownerUserId,
        title: form.title,
        parentWorkItemId: form.parentWorkItemId || undefined,
        description: form.description,
        status: form.status,
        priority: Number(form.priority),
        weight: Number(form.weight),
        progress: Number(form.progress),
        startDate: form.startDate || undefined,
        dueDate: form.dueDate || undefined,
      })

      if (response.status === 'error') {
        setFeedback({ tone: 'error', message: response.message })
        return
      }

      navigate(embedded ? '/work-items' : '/dashboard')
    } catch (error) {
      setFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : '업무를 생성하지 못했습니다.',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className={[styles.page, embedded ? styles.pageEmbedded : ''].filter(Boolean).join(' ')}>
      {!embedded ? (
        <header className={styles.pageIntro}>
          <p className={styles.eyebrow}>New Page</p>
          <h2 className={styles.title}>새 업무를 문서처럼 작성하세요.</h2>
          <p className={styles.description}>
            담당 조직, 담당자, 일정, 진행 속성을 한 페이지에서 작성하고 바로 업무를 생성할 수 있습니다.
          </p>
        </header>
      ) : null}

      <div className={[styles.layout, embedded ? styles.layoutEmbedded : ''].filter(Boolean).join(' ')}>
        <section className={[styles.editorPanel, embedded ? styles.editorPanelEmbedded : ''].filter(Boolean).join(' ')}>
          <WorkItemCreateForm
            composer={activeComposer}
            form={form}
            categoryRequired={!isServerMode}
            categorySupported={!isServerMode}
            submitting={submitting}
            feedback={feedback ?? (serverAvailabilityMessage
              ? { tone: 'error', message: serverAvailabilityMessage }
              : null)}
            submitDisabled={Boolean(serverAvailabilityMessage)}
            onSubmit={handleSubmit}
            onCancel={() => navigate('/work-items')}
            onFieldChange={setField}
          />
        </section>

        {!embedded ? (
          <aside className={styles.sidebar}>
            <WorkItemCreateSidebar composer={activeComposer} />
          </aside>
        ) : null}
      </div>
    </section>
  )
}
