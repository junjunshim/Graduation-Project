import { Link } from 'react-router-dom'
import type { TodoItem } from '../../todo/types'
import { formatTodoDate, getTodoStatusMeta } from '../../todo/utils'
import { TodoStatusBadge } from '../../todo/components/TodoStatusBadge'
import styles from './HomeDashboard.module.css'

type HomeTaskPanelsProps = {
  upcomingTodos: TodoItem[]
  recentTodos: TodoItem[]
  plannedTodos: TodoItem[]
  inProgressTodos: TodoItem[]
  doneTodos: TodoItem[]
}

function TodoLinkItem({ todo }: { todo: TodoItem }) {
  return (
    <Link to={`/todos/${todo.id}`} className={styles.todoLink}>
      <div className={styles.todoLinkMain}>
        <strong className={styles.todoLinkTitle}>{todo.title}</strong>
        <p className={styles.todoLinkDescription}>{todo.description}</p>
      </div>

      <div className={styles.todoLinkMeta}>
        <TodoStatusBadge status={todo.status} />
        <span className={styles.todoLinkDate}>{formatTodoDate(todo.dueDate)}</span>
      </div>
    </Link>
  )
}

export function HomeTaskPanels({
  upcomingTodos,
  recentTodos,
  plannedTodos,
  inProgressTodos,
  doneTodos,
}: HomeTaskPanelsProps) {
  const columns = [
    { title: '예정', todos: plannedTodos },
    { title: '진행중', todos: inProgressTodos },
    { title: '완료', todos: doneTodos },
  ]

  return (
    <>
      <div className={styles.panelGrid}>
        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.panelEyebrow}>Focus Queue</p>
              <h2 className={styles.panelTitle}>집중 작업</h2>
            </div>
            <Link to="/todos" className={styles.inlineLink}>
              전체 보기
            </Link>
          </div>

          <div className={styles.todoList}>
            {upcomingTodos.map((todo) => (
              <TodoLinkItem key={todo.id} todo={todo} />
            ))}
          </div>
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.panelEyebrow}>Recent Pages</p>
              <h2 className={styles.panelTitle}>최근 항목</h2>
            </div>
            <span className={styles.panelCaption}>최근 작업 흐름 기준</span>
          </div>

          <div className={styles.recentList}>
            {recentTodos.map((todo) => {
              const statusMeta = getTodoStatusMeta(todo.status)

              return (
                <Link key={todo.id} to={`/todos/${todo.id}`} className={styles.recentItem}>
                  <div className={styles.recentMain}>
                    <strong className={styles.recentTitle}>{todo.title}</strong>
                    <span className={styles.recentSubtitle}>{statusMeta.label}</span>
                  </div>
                  <span className={styles.recentDate}>{formatTodoDate(todo.dueDate)}</span>
                </Link>
              )
            })}
          </div>
        </section>
      </div>

      <section className={styles.boardPanel}>
        <div className={styles.panelHeader}>
          <div>
            <p className={styles.panelEyebrow}>Status Board</p>
            <h2 className={styles.panelTitle}>상태별 개요</h2>
          </div>
          <Link to="/todos" className={styles.inlineLink}>
            데이터베이스에서 이어서 보기
          </Link>
        </div>

        <div className={styles.boardColumns}>
          {columns.map((column) => (
            <div key={column.title} className={styles.boardColumn}>
              <div className={styles.boardColumnHeader}>
                <strong className={styles.boardColumnTitle}>{column.title}</strong>
                <span className={styles.boardCount}>{column.todos.length}</span>
              </div>

              <div className={styles.boardCards}>
                {column.todos.length > 0 ? (
                  column.todos.map((todo) => (
                    <Link key={todo.id} to={`/todos/${todo.id}`} className={styles.boardCard}>
                      <strong className={styles.boardCardTitle}>{todo.title}</strong>
                      <span className={styles.boardCardDate}>{formatTodoDate(todo.dueDate)}</span>
                    </Link>
                  ))
                ) : (
                  <div className={styles.emptyColumn}>표시할 항목이 없습니다.</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </>
  )
}
