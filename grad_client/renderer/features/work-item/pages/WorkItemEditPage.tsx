import { type FormEvent, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { getCurrentUser } from '../../auth/api'
import { getCascadeWorkItemSummary } from '../../workspace/data/cascadeWorkItemHelper'
import { getOrgSnapshot } from '../../workspace/data/orgService'
import { updateWorkItem } from '../../workspace/data/workItemService'
import {
  canAssignOthersWorkItem,
  getWorkItemPermissions,
} from '../../workspace/model/workItemPermission'
import type { WorkItemRecord } from '../../workspace/model/types'
import { getSelectedWorkItemDetail } from '../../workspace/queries/selectedWorkItemDetail'
import { getServerAssignableUsers } from '../../workspace/queries/serverWorkItemCreateContract'
import { getWorkItemComposerContext } from '../../workspace/queries/workItemComposer'
import { WorkItemCreateForm } from '../components/WorkItemCreateForm'
import { WorkItemEditSidebar } from '../components/WorkItemEditSidebar'
import type { WorkItemCreateFormState } from '../hooks/useWorkItemCreateForm'
import { getWorkItemDateRangeError } from '../model/workItemFormValidation'
import { createWorkItemUpdatePayload, hasWorkItemChanges } from '../model/workItemUpdatePayload'
import styles from '../styles/WorkItemCreatePage.module.css'
import editStyles from './WorkItemEditPage.module.css'

function createInitialForm(item?: WorkItemRecord): WorkItemCreateFormState {
  return {
    categoryId: item?.category?.trim() ?? '',
    ownerNodeId: item ? String(item.ownerNodeId) : '',
    ownerUserId: item?.ownerUserId ?? '',
    title: item?.title ?? '',
    parentWorkItemId: item?.parentWorkItemId ?? '',
    description: item?.description ?? '',
    hidden: Boolean(item?.hidden),
    status: item?.status ?? 'todo',
    priority: String(item?.priority ?? 3),
    weight: String(item?.weight ?? 0),
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
  const [feedback, setFeedback] = useState<{
    tone: 'error' | 'success' | 'info'
    message: string
  } | null>(null)

  if (!currentUser) {
    return null
  }

  if (!detail) {
    return (
      <div className={styles.page}>
        <div className={editStyles.emptyState}>
          <h2 className={editStyles.title}>수정할 업무를 찾을 수 없습니다.</h2>
          <p className={editStyles.description}>
            요청한 업무가 없거나 현재 계정으로 접근할 수 없는 항목입니다.
          </p>
          <Link to="/work-items" className={editStyles.primaryAction}>업무 목록으로 돌아가기</Link>
        </div>
      </div>
    )
  }

  const { item } = detail
  // 서버(update_work_item)가 최종 판정하지만, 권한이 없으면 화면 자체를 막는다.
  const permissions = getWorkItemPermissions(item, currentUser.userId, snapshot)

  if (!permissions.canEdit) {
    return (
      <div className={styles.page}>
        <div className={editStyles.emptyState}>
          <h2 className={editStyles.title}>업무를 수정할 권한이 없습니다.</h2>
          <p className={editStyles.description}>
            이 업무를 수정하려면 해당 워크스페이스의 업무 변경 권한이 필요합니다.
          </p>
          <Link to={`/work-items/${item.workItemId}`} className={editStyles.primaryAction}>
            업무 상세로 돌아가기
          </Link>
        </div>
      </div>
    )
  }

  // 자기 자신과 하위 업무는 상위 업무 후보에서 제외한다(순환 방지).
  const excludedParentIds = new Set(
    getCascadeWorkItemSummary(item.workItemId, snapshot.workItems)?.allWorkItems.map(
      (workItem) => workItem.workItemId,
    ) ?? [item.workItemId],
  )
  const baseComposer = getWorkItemComposerContext(currentUser.userId, item.ownerNodeId, snapshot)

  // 담당자 후보는 서버(update_work_item)와 같은 기준으로 거른다.
  // - 후보: 해당 노드에서 업무를 수행할 수 있는(WI_PERSONAL_CHANGE) 사용자 (+ 숨김 업무면 WI_HIDDEN_CHANGE)
  // - 다른 사람에게 배정하려면 WI_ASSIGN 이 필요하므로, 없으면 본인만 후보로 남긴다.
  const assignablePool = getServerAssignableUsers(item.ownerNodeId, snapshot, form.hidden)
  const assignableCandidates = canAssignOthersWorkItem(item, currentUser.userId, snapshot)
    ? assignablePool
    : assignablePool.filter((user) => user.userId === currentUser.userId)
  // 현재 담당자는 후보 조건을 만족하지 못하더라도 표시와 유지를 위해 항상 포함한다.
  const currentOwnerUser = snapshot.users.find((user) => user.userId === item.ownerUserId)
  const assignableUsers =
    currentOwnerUser && !assignableCandidates.some((user) => user.userId === currentOwnerUser.userId)
      ? [currentOwnerUser, ...assignableCandidates]
      : assignableCandidates

  const composer = {
    ...baseComposer,
    assignableUsers,
    availableParentItems: baseComposer.availableParentItems.filter(
      (parent) => !excludedParentIds.has(parent.workItemId),
    ),
  }
  const hasChanges = hasWorkItemChanges(item.workItemId, initialForm, form)

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

    if (!permissions.canEdit) {
      setSubmitting(false)
      setFeedback({ tone: 'error', message: '업무를 수정할 권한이 없습니다.' })
      return
    }

    // 변경된 항목이 없으면 서버를 호출하지 않는다.
    if (!hasChanges) {
      setFeedback({ tone: 'info', message: '수정된 내용이 없습니다. 항목을 변경한 뒤 저장해 주세요.' })
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
    <div className={styles.page}>
      {/* 상단 브레드크럼 및 네비게이션 */}
      <div className={styles.breadcrumbRow}>
        <Link to={`/work-items/${item.workItemId}`} className={styles.backLink}>
          <span>←</span> 업무 상세로
        </Link>
        <span className={styles.breadcrumbDivider}>/</span>
        <span className={styles.currentBreadcrumb}>업무 수정</span>
      </div>

      {/* 메인 레이아웃 (좌: 폼 카드 그룹, 우: 실시간 요약 사이드바) */}
      <div className={styles.layout}>
        <main className={styles.mainContent}>
          <WorkItemCreateForm
            composer={composer}
            form={form}
            submitting={submitting}
            feedback={feedback}
            onSubmit={handleSubmit}
            onCancel={() => navigate(`/work-items/${item.workItemId}`)}
            onFieldChange={setField}
            nodeLocked
            submitLabel="저장"
            submittingLabel="저장 중..."
            submitDisabled={!hasChanges}
            submitHint="변경된 항목이 없어 저장할 수 없습니다."
          />
        </main>

        <aside className={styles.sidebar}>
          <WorkItemEditSidebar
            item={item}
            initialForm={initialForm}
            form={form}
            composer={composer}
          />
        </aside>
      </div>
    </div>
  )
}
