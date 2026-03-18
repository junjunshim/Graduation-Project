import { Link } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import type { TodoStats } from '../../todo/selectors'
import styles from './HomeDashboard.module.css'

type HomeOverviewProps = {
  stats: TodoStats
  focusTodoId?: string
}

export function HomeOverview({ stats, focusTodoId }: HomeOverviewProps) {
  const statCards = [
    {
      label: '전체 페이지',
      value: stats.total,
      description: '현재 워크스페이스에서 관리 중인 전체 할 일 수',
    },
    {
      label: '예정',
      value: stats.planned,
      description: '착수 대기 중인 작업',
    },
    {
      label: '진행중',
      value: stats.inProgress,
      description: '현재 집중 중인 작업',
    },
    {
      label: '완료',
      value: `${stats.completionRate}%`,
      description: '전체 진행률 기준 완료 비율',
    },
  ]

  return (
    <>
      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <p className={styles.eyebrow}>Main Workspace</p>
          <h1 className={styles.heroTitle}>Notion처럼 한눈에 보는 졸업 프로젝트 보드</h1>
          <p className={styles.heroDescription}>
            오늘 해야 할 일, 이번 주 마감, 최근 문서를 같은 흐름 안에서 정리했습니다.
            필요한 정보는 아래 대시보드와 데이터베이스에서 바로 확인할 수 있습니다.
          </p>
        </div>

        <div className={styles.heroActions}>
          <Link to="/todos" className={styles.primaryLink}>
            <span>데이터베이스 열기</span>
            <Icon name="arrowRight" size={16} />
          </Link>

          <Link
            to={focusTodoId ? `/todos/${focusTodoId}` : '/todos'}
            className={styles.secondaryLink}
          >
            집중 작업 보기
          </Link>
        </div>
      </section>

      <section className={styles.statGrid}>
        {statCards.map((card) => (
          <article key={card.label} className={styles.statCard}>
            <p className={styles.statLabel}>{card.label}</p>
            <strong className={styles.statValue}>{card.value}</strong>
            <p className={styles.statDescription}>{card.description}</p>
          </article>
        ))}
      </section>

      <section className={styles.workspaceNote}>
        <div className={styles.noteIcon}>
          <Icon name="calendar" size={16} />
        </div>
        <div>
          <strong className={styles.noteTitle}>이번 주 마감 {stats.dueThisWeek}개</strong>
          <p className={styles.noteText}>
            진행중 항목과 예정 항목을 중심으로 마감이 가까운 순서대로 정렬해 두었습니다.
          </p>
        </div>
      </section>
    </>
  )
}
