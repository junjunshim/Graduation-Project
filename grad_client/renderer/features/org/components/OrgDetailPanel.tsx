import { Link } from 'react-router-dom'
import { formatWorkspaceDate } from '../../workspace/model/formatters'
import { getNodeTypeLabel, getWorkItemStatusLabel, getWorkItemStatusTone } from '../../workspace/model/labels'
import type { SelectedNodeDetail, WorkItemRecord } from '../../workspace/model/types'
import styles from '../styles/OrgManagePage.module.css'

function WorkItemBadge({ item }: { item: WorkItemRecord }) {
  const tone = getWorkItemStatusTone(item.status)

  return (
    <span
      className={[
        styles.statusBadge,
        tone === 'todo' ? styles.statusTodo : tone === 'inProgress' ? styles.statusInProgress : styles.statusDone,
      ].join(' ')}
    >
      {getWorkItemStatusLabel(item.status)}
    </span>
  )
}

type OrgDetailPanelProps = {
  selectedDetail: SelectedNodeDetail | null
}

export function OrgDetailPanel({ selectedDetail }: OrgDetailPanelProps) {
  if (!selectedDetail) {
    return (
      <section className={styles.panel}>
        <p className={styles.emptyState}>조직을 선택하면 상세 정보를 확인할 수 있습니다.</p>
      </section>
    )
  }

  return (
    <>
      <section className={styles.summaryPanel}>
        <p className={styles.panelEyebrow}>Selected Node</p>
        <strong className={styles.summaryTitle}>{selectedDetail.node.name}</strong>
        <div className={styles.breadcrumb} aria-label="조직 경로">
          {selectedDetail.pathLabel.split(' / ').map((label, index) => (
            <span key={`${label}-${index}`}>{label}</span>
          ))}
        </div>
        <div className={styles.summaryFacts}>
          <span>{getNodeTypeLabel(selectedDetail.node.nodeType)}</span>
          <span>직속 권한 {selectedDetail.directRoles.length}</span>
          <span>직속 업무 {selectedDetail.directWorkItems.length}</span>
          <span>하위 조직 {selectedDetail.childNodes.length}</span>
          <span>{selectedDetail.canManage ? '관리 가능' : '읽기 전용'}</span>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.panelEyebrow}>Children</p>
            <h3 className={styles.panelTitle}>하위 조직</h3>
          </div>
        </div>

        <div className={styles.databaseList}>
          {selectedDetail.childNodes.length > 0 ? (
            selectedDetail.childNodes.map((childNode) => (
              <article key={childNode.id} className={styles.databaseRow}>
                <div className={styles.rowCopy}>
                  <strong>{childNode.name}</strong>
                  <p className={styles.rowMeta}>경로 길이 {childNode.path.length} · ID {childNode.id}</p>
                </div>
                <span className={styles.treeBadge}>{getNodeTypeLabel(childNode.nodeType)}</span>
              </article>
            ))
          ) : (
            <p className={styles.emptyState}>하위 조직이 없습니다.</p>
          )}
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.panelEyebrow}>Roles</p>
            <h3 className={styles.panelTitle}>직접 부여된 권한</h3>
          </div>
        </div>

        <div className={styles.databaseList}>
          {selectedDetail.directRoles.length > 0 ? (
            selectedDetail.directRoles.map((role) => (
              <article key={role.assignmentId} className={styles.databaseRow}>
                <div className={styles.rowCopy}>
                  <strong>{role.name}</strong>
                  <p className={styles.rowMeta}>
                    {role.userId} · {role.email}
                  </p>
                </div>
                <span className={styles.treeBadge}>{role.roleName}</span>
              </article>
            ))
          ) : (
            <p className={styles.emptyState}>직접 부여된 권한이 없습니다.</p>
          )}
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.panelEyebrow}>Work Items</p>
            <h3 className={styles.panelTitle}>직접 연결된 업무</h3>
          </div>
        </div>

        <div className={styles.databaseList}>
          {selectedDetail.directWorkItems.length > 0 ? (
            selectedDetail.directWorkItems.map((item) => (
              <Link
                key={item.workItemId}
                to={`/work-items/${item.workItemId}`}
                className={[styles.databaseRow, styles.databaseRowLink].join(' ')}
              >
                <div className={styles.rowCopy}>
                  <strong>{item.title}</strong>
                  <p className={styles.rowMeta}>
                    {item.workItemId} · 진행률 {item.progress}% · 우선순위 {item.priority} · 마감{' '}
                    {formatWorkspaceDate(item.dueDate)}
                  </p>
                </div>
                <WorkItemBadge item={item} />
              </Link>
            ))
          ) : (
            <p className={styles.emptyState}>직접 연결된 업무가 없습니다.</p>
          )}
        </div>
      </section>
    </>
  )
}
