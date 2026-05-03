import type { FormEvent } from 'react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getCurrentUser } from '../../auth/api'
import { createWorkItem } from '../../workspace/data/workItemService'
import { WorkItemCreateForm } from '../components/WorkItemCreateForm'
import { WorkItemCreateSidebar } from '../components/WorkItemCreateSidebar'
import { useWorkItemCreateForm } from '../hooks/useWorkItemCreateForm'
import styles from '../styles/WorkItemCreatePage.module.css'

export function WorkItemCreatePage() {
  const navigate = useNavigate()
  const currentUser = getCurrentUser()
  const [feedback, setFeedback] = useState<{ tone: 'error' | 'success'; message: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const { composer, form, setField } = useWorkItemCreateForm(currentUser?.userId)

  if (!currentUser || !composer) {
    return null
  }

  const activeComposer = composer

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setFeedback(null)

    if (!form.title.trim()) {
      setSubmitting(false)
      setFeedback({ tone: 'error', message: '업무 제목을 입력해 주세요.' })
      return
    }

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
        <p className={styles.eyebrow}>New Page</p>
        <h2 className={styles.title}>새 업무를 문서처럼 작성하세요.</h2>
        <p className={styles.description}>
          담당 조직, 담당자, 일정, 진행 속성을 한 페이지에서 작성하고 바로 업무를 생성할 수 있습니다.
        </p>
      </header>

      <div className={styles.layout}>
        <section className={styles.editorPanel}>
          <WorkItemCreateForm
            composer={activeComposer}
            form={form}
            submitting={submitting}
            feedback={feedback}
            onSubmit={handleSubmit}
            onFieldChange={setField}
          />
        </section>

        <aside className={styles.sidebar}>
          <WorkItemCreateSidebar composer={activeComposer} />
        </aside>
      </div>
    </section>
  )
}
