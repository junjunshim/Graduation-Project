import { Link } from 'react-router-dom'
import { getTodos } from '../api'
import styles from './TodoPage.module.css'

const statusLabel = {
  planned: '예정',
  'in-progress': '진행중',
  done: '완료',
} as const

export function TodoListPage() {
  const todos = getTodos()

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Todo</p>
        <h2 className={styles.title}>할 일 목록</h2>
      </header>

      <ul className={styles.list}>
        {todos.map((todo) => (
          <li key={todo.id}>
            <Link to={`/todos/${todo.id}`} className={`glass-card ${styles.todoCard}`}>
              <div className={styles.todoTop}>
                <span className={`glass-chip ${styles.status}`} data-status={todo.status}>
                  {statusLabel[todo.status]}
                </span>
                <span className={styles.date}>{todo.dueDate}</span>
              </div>

              <strong className={styles.cardTitle}>{todo.title}</strong>
              <p className={styles.cardDescription}>{todo.description}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
