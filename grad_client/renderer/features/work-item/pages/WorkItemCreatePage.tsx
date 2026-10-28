import type { FormEvent } from 'react'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import { getCurrentUser } from '../../auth/api'
import { getOrgSnapshot } from '../../workspace/data/orgService'
import { createWorkItem } from '../../workspace/data/workItemService'
import { canCreateWorkItem } from '../../workspace/model/effectiveAuthority'
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
  const snapshot = getOrgSnapshot()
  const currentUser = getCurrentUser(snapshot)
  const [feedback, setFeedback] = useState<{ tone: 'error' | 'success'; message: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const { composer, form, setField } = useWorkItemCreateForm(currentUser?.userId, initialNodeId, searchParams.get('parentWorkItemId') ?? undefined)

  if (!currentUser || !composer) {
    return null
  }

  // 특정 워크스페이스(nodeId)로 진입했으나 해당 노드에 업무 생성/배정 권한이 없는 경우 차단
  if (initialNodeId) {
    const hasPermissionForNode = canCreateWorkItem(currentUser.userId, initialNodeId, snapshot)
    if (!hasPermissionForNode) {
      const targetNode = snapshot.nodes.find((n) => n.id === initialNodeId)
      return (
        <div className={styles.page}>
          <div className={styles.breadcrumbRow}>
            <Link to={`/workspace?nodeId=${initialNodeId}&view=tasks`} className={styles.backLink}>
              <span>←</span> 워크스페이스로 돌아가기
            </Link>
          </div>
          <div className={styles.emptyCard}>
            <Icon name="lock" size={36} className={styles.emptyIcon} />
            <h2>업무 생성 권한이 없습니다</h2>
            <p>
              &apos;{targetNode?.name ?? '해당 워크스페이스'}&apos; 공간에 업무를 생성하거나 배정할 수 있는 권한이 없습니다.
            </p>
            <button
              type="button"
              className={styles.backLink}
              onClick={() => navigate(`/workspace?nodeId=${initialNodeId}&view=tasks`)}
            >
              업무 탭으로 이동
            </button>
          </div>
        </div>
      )
    }
  }

  const activeComposer = composer
  const serverAvailabilityMessage = !activeComposer.selectedNode
    ? '업무를 생성할 직접 권한(업무 생성 권한)이 있는 조직이 없습니다.'
    : activeComposer.assignableUsers.length === 0
      ? '선택한 조직에 업무 담당자로 지정할 직접 멤버가 없습니다.'
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
