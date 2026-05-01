import { Link } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import { formatWorkspaceDate } from '../../workspace/model/formatters'
import type { WorkItemRecord } from '../../workspace/model/types'
import { DashboardEmptyState } from './DashboardEmptyState'
import styles from '../pages/DashboardPage.module.css'

export function DashboardDocumentsPanel({ recentDocuments }: { recentDocuments: WorkItemRecord[] }) {
  return (
    <section className={[styles.panel, styles.documentsPanel].join(' ')}>
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.sectionEyebrow}>Documents</p>
          <h3 className={styles.sectionTitle}>최근 문서</h3>
        </div>
      </div>

      <div className={styles.documentList}>
        {recentDocuments.length > 0 ? (
          recentDocuments.map((item) => (
            <Link key={item.workItemId} to={`/work-items/${item.workItemId}`} className={styles.documentRow}>
              <span className={styles.documentIcon}>
                <Icon name="fileText" size={17} />
              </span>
              <div className={styles.documentCopy}>
                <strong>{item.title}</strong>
                <p>
                  {item.workItemId} · 담당 {item.ownerUserId}
                </p>
              </div>
              <span className={styles.documentDate}>{formatWorkspaceDate(item.createdAt)}</span>
            </Link>
          ))
        ) : (
          <DashboardEmptyState>최근 문서로 표시할 업무가 없습니다.</DashboardEmptyState>
        )}
      </div>
    </section>
  )
}
