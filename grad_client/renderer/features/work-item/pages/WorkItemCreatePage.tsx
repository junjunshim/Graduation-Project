import type { FormEvent } from 'react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { getCurrentUser } from '../../auth/api'
import { createWorkItem } from '../../workspace/data/workItemService'
import { isServerDataSource } from '../../workspace/data/workspaceMode'
import { WorkItemCreateForm } from '../components/WorkItemCreateForm'
import { WorkItemCreateSidebar } from '../components/WorkItemCreateSidebar'
import { useWorkItemCreateForm } from '../hooks/useWorkItemCreateForm'
import { getWorkItemDateRangeError } from '../model/workItemFormValidation'
import styles from '../styles/WorkItemCreatePage.module.css'

export function WorkItemCreatePage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const requestedNodeId = Number(searchParams.get('nodeId'))
  const initialNodeId = Number.isInteger(requestedNodeId) && requestedNodeId > 0 ? requestedNodeId : undefined
  const currentUser = getCurrentUser()
  const [feedback, setFeedback] = useState<{ tone: 'error' | 'success'; message: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const isServerMode = isServerDataSource()
  const { composer, form, setField } = useWorkItemCreateForm(currentUser?.userId, initialNodeId)

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
        category: form.categoryId || undefined,
        hidden: form.hidden,
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

      // 업무 생성 성공 시 해당 업무 상세 페이지 또는 목록으로 이동
      navigate(`/work-items/${encodeURIComponent(activeComposer.suggestedWorkItemId)}`)
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
    <div className={styles.page}>
      {/* 상단 브레드크럼 및 네비게이션 */}
      <div className={styles.breadcrumbRow}>
        <Link to="/work-items" className={styles.backLink}>
          <span>←</span> 업무 목록으로
        </Link>
        <span className={styles.breadcrumbDivider}>/</span>
        <span className={styles.currentBreadcrumb}>새 업무 작성</span>
      </div>

      {/* 메인 레이아웃 (좌: 폼 카드 그룹, 우: 실시간 요약 사이드바) */}
      <div className={styles.layout}>
        <main className={styles.mainContent}>
          <WorkItemCreateForm
            composer={activeComposer}
            form={form}
            categoryRequired={false}
            categorySupported={true}
            submitting={submitting}
            feedback={feedback ?? (serverAvailabilityMessage
              ? { tone: 'error', message: serverAvailabilityMessage }
              : null)}
            submitDisabled={Boolean(serverAvailabilityMessage)}
            onSubmit={handleSubmit}
            onCancel={() => navigate('/work-items')}
            onFieldChange={setField}
          />
        </main>

        <aside className={styles.sidebar}>
          <WorkItemCreateSidebar composer={activeComposer} form={form} />
        </aside>
      </div>
    </div>
  )
}
