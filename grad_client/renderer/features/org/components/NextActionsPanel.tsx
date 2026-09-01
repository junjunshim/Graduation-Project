import { Link } from 'react-router-dom'
import type { SelectedNodeDetail } from '../../workspace/model/types'
import styles from '../styles/OrgManagePage.module.css'

type NextActionsPanelProps = {
  nextActions: SelectedNodeDetail['nextActions']
}

export function NextActionsPanel({ nextActions }: NextActionsPanelProps) {
  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div>
          <p className={styles.panelEyebrow}>Next Actions</p>
          <h3 className={styles.panelTitle}>다음 작업</h3>
        </div>
      </div>

      <div className={styles.nextActionList}>
        {nextActions.map((action) => (
          <Link key={action.label} to={action.href} className={styles.nextActionItem}>
            <strong>{action.label}</strong>
            <span>{action.description}</span>
          </Link>
        ))}
      </div>
    </section>
  )
}
