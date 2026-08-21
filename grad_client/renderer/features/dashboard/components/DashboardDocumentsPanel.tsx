import { Link } from 'react-router-dom'
import { DocumentIcon } from '../../../design-system/primitives/DocumentIcon'
import { Icon } from '../../../design-system/primitives/Icon'
import { formatWorkspaceShortDate } from '../../workspace/model/formatters'
import type { UserRecord, WorkItemRecord } from '../../workspace/model/types'
import { DashboardEmptyState } from './DashboardEmptyState'
import styles from '../pages/DashboardPage.module.css'

function getOwnerName(ownerUserId: string, users: UserRecord[]) {
  return users.find((user) => user.userId === ownerUserId)?.name ?? ownerUserId
}

export function DashboardDocumentsPanel({
  recentDocuments,
  users,
}: {
  recentDocuments: WorkItemRecord[]
  users: UserRecord[]
}) {
  return (
    <section className={[styles.panel, styles.documentsPanel].join(' ')}>
      <div className={styles.sectionHeader}>
        <div>
          <h3 className={styles.sectionTitle}>최근 문서</h3>
        </div>
        <Link to="/documents" className={[styles.inlineLink, styles.boardViewLink].join(' ')}>
          전체 보기
          <Icon name="chevronRight" size={15} />
        </Link>
      </div>

      <div className={styles.documentList}>
        {recentDocuments.length > 0 ? (
          recentDocuments.map((item) => (
            <Link key={item.workItemId} to={`/work-items/${item.workItemId}`} className={styles.documentRow}>
              <DocumentIcon />
              <strong className={styles.documentTitle}>{item.title}</strong>
              <span className={styles.documentOwner}>{getOwnerName(item.ownerUserId, users)} ·</span>
              <time className={styles.documentDate} dateTime={item.createdAt}>
                {formatWorkspaceShortDate(item.createdAt)}
              </time>
            </Link>
          ))
        ) : (
          <DashboardEmptyState>최근 문서로 표시할 업무가 없습니다.</DashboardEmptyState>
        )}
      </div>

      <Link to="/documents" className={styles.documentAddLink} aria-label="문서 탭으로 이동">
        <Icon name="plus" size={17} />
      </Link>
    </section>
  )
}
