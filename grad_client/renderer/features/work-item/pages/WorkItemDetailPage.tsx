import type { ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { DocumentIcon } from '../../../design-system/primitives/DocumentIcon'
import { Icon, type IconName } from '../../../design-system/primitives/Icon'
import { UserAvatar } from '../../../design-system/primitives/UserAvatar'
import { getCurrentUser } from '../../auth/api'
import { getOrgSnapshot } from '../../workspace/data/orgService'
import { formatWorkspaceDate } from '../../workspace/model/formatters'
import type { WorkItemRecord } from '../../workspace/model/types'
import { getSelectedWorkItemDetail } from '../../workspace/queries/selectedWorkItemDetail'
import styles from './WorkItemDetailPage.module.css'

type DetailPropertyProps = {
  icon: IconName
  label: string
  children: ReactNode
}

function DetailProperty({ icon, label, children }: DetailPropertyProps) {
  return (
    <div className={styles.property}>
      <span className={styles.propertyLabel}>
        <Icon name={icon} size={14} />
        {label}
      </span>
      <div className={styles.propertyValue}>{children}</div>
    </div>
  )
}

function getPriorityMeta(priority: number) {
  if (priority <= 1) {
    return { label: '매우 높음', symbol: '↑↑', tone: 'highest' }
  }

  if (priority === 2) {
    return { label: '높음', symbol: '↑', tone: 'high' }
  }

  if (priority === 3) {
    return { label: '보통', symbol: '−', tone: 'medium' }
  }

  if (priority === 4) {
    return { label: '낮음', symbol: '↓', tone: 'low' }
  }

  return { label: '매우 낮음', symbol: '↓↓', tone: 'lowest' }
}

function RelatedWorkItemLink({ item }: { item: WorkItemRecord }) {
  return (
    <Link to={`/work-items/${item.workItemId}`} className={styles.relatedItem}>
      <span>
        <strong>{item.title}</strong>
        <small>{item.workItemId}</small>
      </span>
      <Icon name="chevronRight" size={15} />
    </Link>
  )
}

export function WorkItemDetailPage() {
  const snapshot = getOrgSnapshot()
  const currentUser = getCurrentUser(snapshot)
  const { workItemId } = useParams()

  if (!currentUser) {
    return null
  }

  const detail = workItemId
    ? getSelectedWorkItemDetail(workItemId, currentUser.userId, snapshot)
    : null

  if (!detail) {
    return (
      <section className={styles.page}>
        <div className={styles.emptyState}>
          <h2>업무를 찾을 수 없습니다.</h2>
          <p>요청한 업무가 없거나 현재 계정으로 접근할 수 없는 항목입니다.</p>
          <Link to="/work-items" className={styles.editButton}>업무 목록으로 돌아가기</Link>
        </div>
      </section>
    )
  }

  const { item, ownerUser, parentWorkItem, childWorkItems } = detail
  const priority = getPriorityMeta(item.priority)
  const progress = Math.min(100, Math.max(0, item.progress))
  const description = item.description.trim() || '업무 설명이 아직 등록되지 않았습니다.'
  const hasRelatedWorkItems = Boolean(parentWorkItem || childWorkItems.length > 0)

  return (
    <section className={styles.page}>
      <section className={styles.progressPanel} aria-label={`진행률 ${progress}%`}>
        <strong>진행 현황</strong>
        <div className={styles.progressTrack} aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
        <strong className={styles.progressPercent}>{progress}%</strong>
      </section>

      <section className={styles.propertyGrid} aria-label="업무 주요 정보">
        <DetailProperty icon="user" label="담당자">
          <span className={styles.ownerValue}>
            <UserAvatar name={ownerUser.name} userId={ownerUser.userId} size="medium" />
            {ownerUser.name}
          </span>
        </DetailProperty>

        <DetailProperty icon="trendingUp" label="우선순위">
          <span className={styles.priorityBadge} data-tone={priority.tone}>
            {priority.symbol} {priority.label}
          </span>
        </DetailProperty>

        <DetailProperty icon="calendar" label="마감일">
          {formatWorkspaceDate(item.dueDate)}
        </DetailProperty>

        <DetailProperty icon="clock" label="생성일">
          {formatWorkspaceDate(item.createdAt)}
        </DetailProperty>

        <DetailProperty icon="calendar" label="시작일">
          {formatWorkspaceDate(item.startDate)}
        </DetailProperty>
      </section>

      <section className={styles.contentPanel}>
        <h3>업무 설명</h3>
        <p className={styles.description}>{description}</p>
      </section>

      {hasRelatedWorkItems ? (
        <section className={styles.contentPanel}>
          <h3>관련 업무</h3>
          <div className={styles.relatedList}>
            {parentWorkItem ? <RelatedWorkItemLink item={parentWorkItem} /> : null}
            {childWorkItems.map((childItem) => (
              <RelatedWorkItemLink key={childItem.workItemId} item={childItem} />
            ))}
          </div>
        </section>
      ) : null}

      <section className={styles.contentPanel}>
        <h3>활동 내역 / 댓글</h3>
        <div className={styles.emptyPanelState}>
          <Icon name="messageCircle" size={19} />
          <span>등록된 활동이나 댓글이 없습니다.</span>
        </div>
      </section>

      <section className={styles.attachmentPanel}>
        <div>
          <h3>첨부파일</h3>
          <div className={styles.emptyAttachment}>
            <DocumentIcon size={18} />
            <span>첨부된 파일이 없습니다.</span>
          </div>
        </div>
        <button type="button" className={styles.addFileButton} disabled title="첨부파일 기능 개발 예정">
          <Icon name="plus" size={15} />
          파일 추가
        </button>
      </section>

      <footer className={styles.actions}>
        <button type="button" className={styles.deleteButton} disabled title="업무 삭제 기능 개발 예정">
          삭제
        </button>
        <Link to={`/work-items/${item.workItemId}/edit`} className={styles.editButton}>
          수정
        </Link>
      </footer>
    </section>
  )
}
