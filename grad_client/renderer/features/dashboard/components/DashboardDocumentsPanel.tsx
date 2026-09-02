import { Link } from 'react-router-dom'
import { DocumentIcon } from '../../../design-system/primitives/DocumentIcon'
import { Icon } from '../../../design-system/primitives/Icon'
import { formatWorkspaceShortDate } from '../../workspace/model/formatters'
import type { WorkItemFileRecord } from '../../workspace/model/types'
import { DashboardEmptyState } from './DashboardEmptyState'
import styles from '../pages/DashboardPage.module.css'

export function DashboardDocumentsPanel({
  files,
}: {
  files: WorkItemFileRecord[]
}) {
  const activeFiles = files.filter((file) => !file.isDeleted).slice(0, 5)

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
        {activeFiles.length > 0 ? (
          activeFiles.map((file) => (
            <Link
              key={file.id}
              to={`/work-items/${file.workItemId}`}
              className={styles.documentRow}
              title={`${file.originalFileName} (${file.workItemId})`}
            >
              <DocumentIcon />
              <div className={styles.documentCopy}>
                <strong className={styles.documentTitle}>{file.originalFileName}</strong>
              </div>
              <span className={styles.documentOwner}>
                {file.workItemId} · {file.uploaderName || file.uploaderUserId}
              </span>
              <time className={styles.documentDate} dateTime={file.createdAt}>
                {formatWorkspaceShortDate(file.createdAt)}
              </time>
            </Link>
          ))
        ) : (
          <DashboardEmptyState>최근 업로드된 문서가 없습니다.</DashboardEmptyState>
        )}
      </div>

      <Link to="/documents" className={styles.documentAddLink} aria-label="문서 탭으로 이동">
        <Icon name="plus" size={17} />
      </Link>
    </section>
  )
}

