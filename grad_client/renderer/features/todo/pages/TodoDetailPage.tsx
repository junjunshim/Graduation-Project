import { Link, useParams } from 'react-router-dom'
import { getTodoById } from '../api'
import styles from './TodoPage.module.css'

const statusLabel = {
  planned: '예정',
  'in-progress': '진행중',
  done: '완료',
} as const

export function TodoDetailPage() {
  const { todoId } = useParams()
  const todo = todoId ? getTodoById(todoId) : undefined

  if (!todo) {
    return (
      <section className={styles.page}>
        <div className={`glass-card ${styles.emptyCard}`}>
          <h2 className={styles.emptyTitle}>할 일을 찾을 수 없어요.</h2>
          <p className={styles.emptyText}>
            선택한 항목이 없거나 잘못된 주소로 들어왔습니다.
          </p>
          <Link to="/todos" className={`glass-button ${styles.backLink}`}>
            목록으로 돌아가기
          </Link>
        </div>
      </section>
    )
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Todo Detail</p>
        <h2 className={styles.title}>상세 보기</h2>
        <p className={styles.description}>
          아직은 임시일 뿐입니다.
        </p>
      </header>

      <article className={`glass-card ${styles.detailCard}`}>
        <div className={styles.detailTop}>
          <div className={styles.detailTitleGroup}>
            <span className={`glass-chip ${styles.status}`} data-status={todo.status}>
              {statusLabel[todo.status]}
            </span>
            <h3 className={styles.detailTitle}>{todo.title}</h3>
          </div>

          <Link to="/todos" className={`glass-button ${styles.backLink}`}>
            목록으로
          </Link>
        </div>

        <p className={styles.detailDescription}>{todo.description}</p>

        <div className={styles.metaGrid}>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>ID</span>
            <span className={styles.metaValue}>{todo.id}</span>
          </div>

          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>마감일</span>
            <span className={styles.metaValue}>{todo.dueDate}</span>
          </div>
        </div>
      </article>
    </section>
  )
}
