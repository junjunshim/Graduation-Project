import type { UserRecord } from '../../workspace/model/types'
import styles from '../styles/OrgManagePage.module.css'

type InheritedManagersPanelProps = {
  managers: UserRecord[]
}

export function InheritedManagersPanel({ managers }: InheritedManagersPanelProps) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.panelEyebrow}>Managers</p>
          <h3 className={styles.panelTitle}>관리 가능한 사용자</h3>
        </div>
      </div>

      <div className={styles.databaseList}>
        {managers.length > 0 ? (
          managers.map((manager) => (
            <article key={manager.userId} className={styles.databaseRow}>
              <div className={styles.rowCopy}>
                <strong>{manager.name}</strong>
                <p className={styles.rowMeta}>
                  {manager.userId} · {manager.email}
                </p>
              </div>
            </article>
          ))
        ) : (
          <p className={styles.emptyState}>상속된 관리자 정보가 없습니다.</p>
        )}
      </div>
    </section>
  )
}
