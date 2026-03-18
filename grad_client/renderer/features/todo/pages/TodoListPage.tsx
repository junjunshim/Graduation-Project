import { Link } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import { getTodos } from '../api'
import { TodoDatabaseRow } from '../components/TodoDatabaseRow'
import { getTodoStats, sortTodosByDueDate } from '../selectors'
import styles from './TodoPage.module.css'

export function TodoListPage() {
  const todos = sortTodosByDueDate(getTodos())
  const stats = getTodoStats(todos)

  const summaryCards = [
    {
      label: '전체',
      value: stats.total,
      description: '현재 문서화된 전체 할 일 페이지',
    },
    {
      label: '진행중',
      value: stats.inProgress,
      description: '바로 확인이 필요한 활성 작업',
    },
    {
      label: '이번 주',
      value: stats.dueThisWeek,
      description: '7일 이내 마감 예정인 항목',
    },
  ]

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Database</p>
          <h1 className={styles.title}>할 일 데이터베이스</h1>
          <p className={styles.description}>
            노션 데이터베이스처럼 상태와 일정, 설명을 한 화면에서 검토할 수 있도록 정리했습니다.
          </p>
        </div>

        <Link to="/" className={styles.secondaryAction}>
          <Icon name="home" size={16} />
          <span>워크스페이스 보기</span>
        </Link>
      </header>

      <section className={styles.summaryGrid}>
        {summaryCards.map((card) => (
          <article key={card.label} className={styles.summaryCard}>
            <p className={styles.summaryLabel}>{card.label}</p>
            <strong className={styles.summaryValue}>{card.value}</strong>
            <p className={styles.summaryDescription}>{card.description}</p>
          </article>
        ))}
      </section>

      <section className={styles.databasePanel}>
        <div className={styles.databaseHeader}>
          <div>
            <p className={styles.panelEyebrow}>Table View</p>
            <h2 className={styles.panelTitle}>모든 페이지</h2>
          </div>

          <div className={styles.databaseMeta}>
            <span className={styles.metaChip}>총 {stats.total}개</span>
            <span className={styles.metaChip}>완료 {stats.done}개</span>
          </div>
        </div>

        <div className={styles.table}>
          <div className={styles.tableHead}>
            <span>이름</span>
            <span>상태</span>
            <span>마감일</span>
            <span />
          </div>

          <div className={styles.tableBody}>
            {todos.map((todo) => (
              <TodoDatabaseRow key={todo.id} todo={todo} />
            ))}
          </div>
        </div>
      </section>
    </section>
  )
}
