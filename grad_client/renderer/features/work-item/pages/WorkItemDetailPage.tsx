import { Link, useParams } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import { getCurrentUser } from '../../auth/api'
import { getOrgSnapshot } from '../../workspace/data/orgService'
import { getSelectedWorkItemDetail } from '../../workspace/queries/selectedWorkItemDetail'
import { formatWorkspaceDate, formatWorkspaceTimestamp } from '../../workspace/model/formatters'
import { getNodeTypeLabel, getWorkItemStatusLabel, getWorkItemStatusTone } from '../../workspace/model/labels'
import type { WorkItemRecord } from '../../workspace/model/types'
import styles from './WorkItemDetailPage.module.css'

function RelatedWorkItemLink({ item, prefix }: { item: WorkItemRecord; prefix: string }) {
  const tone = getWorkItemStatusTone(item.status)

  return (
    <Link to={`/work-items/${item.workItemId}`} className={styles.relatedItem}>
      <div className={styles.relatedCopy}>
        <strong>{item.title}</strong>
        <p className={styles.relatedMeta}>
          {prefix} · {item.workItemId} · 담당자 {item.ownerUserId} · 진행률 {item.progress}% · 마감{' '}
          {formatWorkspaceDate(item.dueDate)}
        </p>
      </div>

      <div className={styles.relatedActions}>
        <span
          className={[
            styles.statusBadge,
            tone === 'todo' ? styles.statusTodo : tone === 'inProgress' ? styles.statusInProgress : styles.statusDone,
          ].join(' ')}
        >
          {getWorkItemStatusLabel(item.status)}
        </span>
        <span className={styles.relatedChevron}>
          <Icon name="chevronRight" size={16} />
        </span>
      </div>
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
          <p className={styles.eyebrow}>Work Item</p>
          <h2 className={styles.emptyTitle}>업무를 찾을 수 없습니다.</h2>
          <p className={styles.emptyText}>
            요청한 업무가 없거나 현재 계정으로 접근할 수 없는 항목입니다. 대시보드에서 다시 선택해 주세요.
          </p>
          <div className={styles.emptyActions}>
            <Link to="/dashboard" className={styles.primaryAction}>
              대시보드로 돌아가기
            </Link>
            <Link to="/work-items/new" className={styles.secondaryAction}>
              업무 등록
            </Link>
          </div>
        </div>
      </section>
    )
  }

  const { item, ownerNode, ownerUser, parentWorkItem, childWorkItems } = detail
  const tone = getWorkItemStatusTone(item.status)
  const description = item.description.trim() || '업무 설명이 아직 등록되지 않았습니다.'

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerPrimary}>
          <p className={styles.eyebrow}>Work Item Detail</p>

          <div className={styles.identityRow}>
            <span className={styles.workItemId}>{item.workItemId}</span>
            <span
              className={[
                styles.statusBadge,
                tone === 'todo' ? styles.statusTodo : tone === 'inProgress' ? styles.statusInProgress : styles.statusDone,
              ].join(' ')}
            >
              {getWorkItemStatusLabel(item.status)}
            </span>
          </div>

          <h2 className={styles.title}>{item.title}</h2>
          <p className={styles.description}>{description}</p>
          <p className={styles.metaLine}>
            담당자 {ownerUser.name} ({ownerUser.userId}) · {getNodeTypeLabel(ownerNode.nodeType)} {ownerNode.name} ·
            마감 {formatWorkspaceDate(item.dueDate)}
          </p>
        </div>

        <div className={styles.headerActions}>
          <Link to={`/work-items/${item.workItemId}/edit`} className={styles.primaryAction}>
            수정
          </Link>
          <Link to="/dashboard" className={styles.secondaryAction}>
            대시보드로 돌아가기
          </Link>
        </div>
      </header>

      <div className={styles.layout}>
        <div className={styles.mainColumn}>
          <section className={styles.panel}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.panelEyebrow}>Summary</p>
                <h3 className={styles.panelTitle}>일정 및 진행 요약</h3>
              </div>
            </div>

            <div className={styles.progressBlock}>
              <div className={styles.progressHeader}>
                <strong>진행률 {item.progress}%</strong>
                <span>{getWorkItemStatusLabel(item.status)}</span>
              </div>
              <div className={styles.progressTrack} aria-hidden="true">
                <span className={styles.progressValue} style={{ width: `${item.progress}%` }} />
              </div>
            </div>

            <div className={styles.metricGrid}>
              <div className={styles.metricItem}>
                <span>우선순위</span>
                <strong>{item.priority}</strong>
              </div>
              <div className={styles.metricItem}>
                <span>가중치</span>
                <strong>{item.weight}</strong>
              </div>
              <div className={styles.metricItem}>
                <span>시작일</span>
                <strong>{formatWorkspaceDate(item.startDate)}</strong>
              </div>
              <div className={styles.metricItem}>
                <span>마감일</span>
                <strong>{formatWorkspaceDate(item.dueDate)}</strong>
              </div>
            </div>
          </section>

          <section className={styles.panel}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.panelEyebrow}>Document</p>
                <h3 className={styles.panelTitle}>업무 설명</h3>
              </div>
            </div>

            <p className={styles.bodyText}>{description}</p>
          </section>

          <section className={styles.panel}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.panelEyebrow}>Parent</p>
                <h3 className={styles.panelTitle}>상위 업무</h3>
              </div>
            </div>

            {parentWorkItem ? (
              <RelatedWorkItemLink item={parentWorkItem} prefix="상위 업무" />
            ) : (
              <p className={styles.emptyCopy}>연결된 상위 업무가 없습니다.</p>
            )}
          </section>

          <section className={styles.panel}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.panelEyebrow}>Children</p>
                <h3 className={styles.panelTitle}>하위 업무</h3>
              </div>
            </div>

            {childWorkItems.length > 0 ? (
              <div className={styles.relatedList}>
                {childWorkItems.map((childItem) => (
                  <RelatedWorkItemLink key={childItem.workItemId} item={childItem} prefix="하위 업무" />
                ))}
              </div>
            ) : (
              <p className={styles.emptyCopy}>연결된 하위 업무가 없습니다.</p>
            )}
          </section>
        </div>

        <aside className={styles.detailSidebar}>
          <section className={styles.sidePanel}>
            <div className={styles.sectionHeader}>
              <div>
                <p className={styles.panelEyebrow}>Properties</p>
                <h3 className={styles.panelTitle}>속성</h3>
              </div>
            </div>

            <dl className={styles.propertyList}>
              <div className={styles.propertyItem}>
                <dt>상태</dt>
                <dd>
                  <span
                    className={[
                      styles.statusBadge,
                      tone === 'todo'
                        ? styles.statusTodo
                        : tone === 'inProgress'
                          ? styles.statusInProgress
                          : styles.statusDone,
                    ].join(' ')}
                  >
                    {getWorkItemStatusLabel(item.status)}
                  </span>
                </dd>
              </div>
              <div className={styles.propertyItem}>
                <dt>진행률</dt>
                <dd>{item.progress}%</dd>
              </div>
              <div className={styles.propertyItem}>
                <dt>우선순위</dt>
                <dd>{item.priority}</dd>
              </div>
              <div className={styles.propertyItem}>
                <dt>가중치</dt>
                <dd>{item.weight}</dd>
              </div>
              <div className={styles.propertyItem}>
                <dt>담당자</dt>
                <dd>
                  {ownerUser.name}
                  <span className={styles.propertySubtext}>{ownerUser.email}</span>
                </dd>
              </div>
              <div className={styles.propertyItem}>
                <dt>소유 조직</dt>
                <dd>
                  {ownerNode.name}
                  <span className={styles.propertySubtext}>{getNodeTypeLabel(ownerNode.nodeType)}</span>
                </dd>
              </div>
              <div className={styles.propertyItem}>
                <dt>조직 경로</dt>
                <dd>{detail.ownerNodePathLabel}</dd>
              </div>
              <div className={styles.propertyItem}>
                <dt>시작일</dt>
                <dd>{formatWorkspaceDate(item.startDate)}</dd>
              </div>
              <div className={styles.propertyItem}>
                <dt>마감일</dt>
                <dd>{formatWorkspaceDate(item.dueDate)}</dd>
              </div>
              <div className={styles.propertyItem}>
                <dt>생성일</dt>
                <dd>{formatWorkspaceTimestamp(item.createdAt)}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </section>
  )
}
