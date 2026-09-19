import { formatWorkspaceDate, formatWorkspaceTimestamp, getWorkItemDisplayCode } from '../../workspace/model/formatters'
import { getWorkItemPriorityMeta, getWorkItemStatusLabel } from '../../workspace/model/labels'
import type { WorkItemComposerContext, WorkItemRecord } from '../../workspace/model/types'
import type { WorkItemCreateFormState } from '../hooks/useWorkItemCreateForm'
import styles from '../styles/WorkItemCreatePage.module.css'

type WorkItemEditSidebarProps = {
  item: WorkItemRecord
  initialForm: WorkItemCreateFormState
  form: WorkItemCreateFormState
  composer: WorkItemComposerContext
}

type ChangeEntry = {
  label: string
  changed: boolean
  before: string
  after: string
}

const TEXT_PREVIEW_LENGTH = 34

function summarizeText(value: string, emptyLabel: string) {
  const trimmed = value.trim()

  if (!trimmed) {
    return emptyLabel
  }

  return trimmed.length > TEXT_PREVIEW_LENGTH ? `${trimmed.slice(0, TEXT_PREVIEW_LENGTH)}…` : trimmed
}

export function WorkItemEditSidebar({ item, initialForm, form, composer }: WorkItemEditSidebarProps) {
  function getNodeLabel(nodeId: string) {
    return composer.availableNodes.find((node) => String(node.id) === nodeId)?.name ?? '미지정'
  }

  function getUserLabel(userId: string) {
    return composer.assignableUsers.find((user) => user.userId === userId)?.name ?? (userId || '미지정')
  }

  function getDateLabel(value: string) {
    return value ? formatWorkspaceDate(value) : '일정 미정'
  }

  function getPriorityLabel(value: string) {
    const meta = getWorkItemPriorityMeta(Number(value))

    return `${meta.symbol} ${meta.label}`
  }

  function getVisibilityLabel(hidden: boolean) {
    return hidden ? '🔒 숨김 업무' : '🌐 일반 공개'
  }

  function getParentLabel(parentWorkItemId: string) {
    if (!parentWorkItemId) {
      return '최상위 업무'
    }

    return (
      composer.availableParentItems.find((parent) => parent.workItemId === parentWorkItemId)?.title ??
      '알 수 없는 업무'
    )
  }

  const assignedUserName = composer.assignableUsers.find((user) => user.userId === form.ownerUserId)?.name

  // 담당자 변경은 claimWorkItem, 나머지는 수정 페이로드에 포함되는 항목만 노출한다
  const candidates: ChangeEntry[] = [
    {
      label: '업무 제목',
      changed: form.title !== initialForm.title,
      before: summarizeText(initialForm.title, '미입력'),
      after: summarizeText(form.title, '미입력'),
    },
    {
      label: '업무 설명',
      changed: form.description !== initialForm.description,
      before: summarizeText(initialForm.description, '내용 없음'),
      after: summarizeText(form.description, '내용 없음'),
    },
    {
      label: '상위 업무',
      changed: form.parentWorkItemId !== initialForm.parentWorkItemId,
      before: getParentLabel(initialForm.parentWorkItemId),
      after: getParentLabel(form.parentWorkItemId),
    },
    {
      label: '담당자',
      changed: form.ownerUserId !== initialForm.ownerUserId,
      before: getUserLabel(initialForm.ownerUserId),
      after: getUserLabel(form.ownerUserId),
    },
    {
      label: '진행 상태',
      changed: form.status !== initialForm.status,
      before: getWorkItemStatusLabel(initialForm.status),
      after: getWorkItemStatusLabel(form.status),
    },
    {
      label: '진행률',
      changed: form.progress !== initialForm.progress,
      before: `${initialForm.progress}%`,
      after: `${form.progress}%`,
    },
    {
      label: '우선순위',
      changed: form.priority !== initialForm.priority,
      before: getPriorityLabel(initialForm.priority),
      after: getPriorityLabel(form.priority),
    },
    {
      label: '가중치',
      changed: form.weight !== initialForm.weight,
      before: initialForm.weight || '-',
      after: form.weight || '-',
    },
    {
      label: '시작일',
      changed: form.startDate !== initialForm.startDate,
      before: getDateLabel(initialForm.startDate),
      after: getDateLabel(form.startDate),
    },
    {
      label: '마감일',
      changed: form.dueDate !== initialForm.dueDate,
      before: getDateLabel(initialForm.dueDate),
      after: getDateLabel(form.dueDate),
    },
    {
      label: '카테고리',
      changed: form.categoryId !== initialForm.categoryId,
      before: initialForm.categoryId || '미분류',
      after: form.categoryId || '미분류',
    },
    {
      label: '공개 여부',
      changed: form.hidden !== initialForm.hidden,
      before: getVisibilityLabel(initialForm.hidden),
      after: getVisibilityLabel(form.hidden),
    },
  ]

  const changes = candidates.filter((candidate) => candidate.changed)

  return (
    <div className={styles.sidebarWrapper}>
      {/* 1. 변경 사항 요약 */}
      <section className={styles.sideCard}>
        <div className={styles.sideCardHeader}>
          <h4 className={styles.sideCardTitle}>변경 사항</h4>
          <span className={styles.completionBadge} data-complete={changes.length === 0}>
            {changes.length === 0 ? '변경 없음' : `${changes.length}건`}
          </span>
        </div>
        {changes.length === 0 ? (
          <p className={styles.changeEmpty}>
            아직 변경된 항목이 없습니다. 항목을 수정하면 변경 내역이 여기에 표시됩니다.
          </p>
        ) : (
          <div className={styles.metaList}>
            {changes.map((change) => (
              <div key={change.label} className={styles.metaItem}>
                <span className={styles.metaLabel}>{change.label}</span>
                <span className={styles.changeValue}>
                  <span className={styles.changeBefore}>{change.before}</span>
                  <span className={styles.changeArrow}>→</span>
                  <strong className={styles.changeAfter}>{change.after}</strong>
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 2. 업무 변경 정보 */}
      <section className={styles.sideCard}>
        <h4 className={styles.sideCardTitle}>업무 변경 정보</h4>
        <div className={styles.metaList}>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>업무 식별 코드</span>
            <strong className={styles.metaValueBadge}>{getWorkItemDisplayCode(item)}</strong>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>담당 조직</span>
            <strong className={styles.metaValue}>{getNodeLabel(form.ownerNodeId)}</strong>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>카테고리 / 공개여부</span>
            <strong className={styles.metaValue}>
              {form.categoryId ? form.categoryId.toUpperCase() : '미분류'} · {getVisibilityLabel(form.hidden)}
            </strong>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>조직 계층 경로</span>
            <span className={styles.metaValuePath}>{composer.pathLabel}</span>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>담당자</span>
            <strong className={styles.metaValue}>{assignedUserName ?? '미지정'}</strong>
          </div>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>최근 수정</span>
            <strong className={styles.metaValue}>{formatWorkspaceTimestamp(item.updatedAt ?? '')}</strong>
          </div>
        </div>
      </section>

      {/* 3. 변경 가이드 */}
      <section className={styles.sideCard}>
        <h4 className={styles.sideCardTitle}>💡 변경 가이드</h4>
        <ul className={styles.tipsList}>
          <li>수정한 항목만 전송되며, 변경하지 않은 값은 그대로 유지됩니다.</li>
          <li>담당자를 다른 사람으로 변경하면 해당 담당자에게 업무가 배정됩니다.</li>
          <li>시작일보다 빠른 마감일은 저장할 수 없고, 마감일이 지난 업무는 지연으로 표시됩니다.</li>
          <li>소속 조직은 만든 뒤 변경할 수 없고, 상위 업무는 현재 노드 또는 직속 상위 노드의 업무로만 옮길 수 있습니다.</li>
        </ul>
      </section>
    </div>
  )
}