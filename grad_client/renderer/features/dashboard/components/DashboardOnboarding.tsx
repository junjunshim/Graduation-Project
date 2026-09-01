import { Link } from 'react-router-dom'
import type { WorkspaceOverview } from '../../workspace/model/types'
import styles from '../pages/DashboardPage.module.css'

export function DashboardOnboarding({ overview }: { overview: WorkspaceOverview }) {
  return (
    <section className={[styles.page, styles.onboardingPage].join(' ')}>
      <header className={styles.onboardingHero}>
        <p className={styles.eyebrow}>Onboarding</p>
        <h2 className={styles.title}>공유 공간을 만들고 운영을 시작하세요.</h2>
        <p className={styles.description}>
          개인 공간은 준비되었습니다. 이제 팀이 함께 사용할 공간을 만들고 담당자와 업무를 연결해 보세요.
        </p>
      </header>

      <section className={styles.panel}>
        <div className={styles.sectionHeader}>
          <div>
            <p className={styles.sectionEyebrow}>Checklist</p>
            <h3 className={styles.sectionTitle}>시작 순서</h3>
          </div>
        </div>

        <div className={styles.onboardingList}>
          {overview.onboardingSteps.map((step, index) => (
            <article key={step.id} className={styles.onboardingItem}>
              <div className={styles.onboardingMeta}>
                <span className={styles.stepIndex}>{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <strong className={styles.onboardingTitle}>{step.title}</strong>
                  <p className={styles.itemDescription}>{step.description}</p>
                </div>
              </div>

              <div className={styles.onboardingActions}>
                <span
                  className={[
                    styles.statusBadge,
                    step.status === 'complete'
                      ? styles.statusDone
                      : step.status === 'current'
                        ? styles.statusInProgress
                        : styles.statusTodo,
                  ].join(' ')}
                >
                  {step.status === 'complete' ? '완료' : step.status === 'current' ? '진행 중' : '예정'}
                </span>
                <Link to={step.href} className={styles.inlineLink}>
                  이동
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>
    </section>
  )
}
