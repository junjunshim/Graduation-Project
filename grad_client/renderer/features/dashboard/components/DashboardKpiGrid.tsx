import { Icon } from '../../../design-system/primitives/Icon'
import type { DashboardMetric, DashboardMetricTone } from '../model/dashboardView'
import styles from '../pages/DashboardPage.module.css'

const kpiToneClassName: Record<DashboardMetricTone, string> = {
  blue: styles.kpiBlue,
  amber: styles.kpiAmber,
  green: styles.kpiGreen,
  neutral: styles.kpiNeutral,
}

export function DashboardKpiGrid({ metrics }: { metrics: DashboardMetric[] }) {
  return (
    <section className={styles.kpiGrid} aria-label="워크스페이스 핵심 지표">
      {metrics.map((metric) => (
        <article key={metric.label} className={[styles.kpiCard, kpiToneClassName[metric.tone]].join(' ')}>
          <div className={styles.kpiHeader}>
            <span className={styles.kpiIcon}>
              <Icon name={metric.icon} size={18} />
            </span>
            <span className={styles.kpiLabel}>{metric.label}</span>
          </div>
          <div className={styles.kpiValueRow}>
            <strong>{metric.value}</strong>
            <span className={styles.kpiSparkline} aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </div>
          <p>{metric.description}</p>
        </article>
      ))}
    </section>
  )
}
