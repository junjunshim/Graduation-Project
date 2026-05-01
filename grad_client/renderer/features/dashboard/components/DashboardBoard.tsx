import { Link } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import type { WorkItemRecord } from '../../workspace/model/types'
import { BOARD_COLUMNS } from '../model/dashboardView'
import { DashboardEmptyState } from './DashboardEmptyState'
import { DashboardWorkItemCard } from './DashboardWorkItemCard'
import styles from '../pages/DashboardPage.module.css'

export function DashboardBoard({ workItems }: { workItems: WorkItemRecord[] }) {
  return (
    <section className={[styles.panel, styles.boardPanel].join(' ')}>
      <div className={styles.sectionHeader}>
        <div>
          <p className={styles.sectionEyebrow}>Work Board</p>
          <h3 className={styles.sectionTitle}>진행 중인 작업</h3>
        </div>
        <Link to="/work-items/new" className={styles.inlineLink}>
          <Icon name="plus" size={15} />
          새 업무
        </Link>
      </div>

      <div className={styles.boardColumns}>
        {BOARD_COLUMNS.map((column) => {
          const columnItems = workItems.filter((item) => item.status === column.id)

          return (
            <section key={column.id} className={styles.boardColumn}>
              <div className={styles.columnHeader}>
                <div>
                  <h4>{column.title}</h4>
                  <p>{column.description}</p>
                </div>
                <strong>{columnItems.length}</strong>
              </div>

              <div className={styles.taskStack}>
                {columnItems.length > 0 ? (
                  columnItems.map((item) => <DashboardWorkItemCard key={item.workItemId} item={item} />)
                ) : (
                  <DashboardEmptyState>표시할 업무가 없습니다.</DashboardEmptyState>
                )}
              </div>
            </section>
          )
        })}
      </div>
    </section>
  )
}
