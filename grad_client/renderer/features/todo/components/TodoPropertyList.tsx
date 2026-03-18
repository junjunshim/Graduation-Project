import type { TodoItem } from '../types'
import { formatTodoDate } from '../utils'
import { TodoStatusBadge } from './TodoStatusBadge'
import styles from './TodoPropertyList.module.css'

type TodoPropertyListProps = {
  todo: TodoItem
}

export function TodoPropertyList({ todo }: TodoPropertyListProps) {
  return (
    <dl className={styles.list}>
      <div className={styles.item}>
        <dt className={styles.label}>상태</dt>
        <dd className={styles.value}>
          <TodoStatusBadge status={todo.status} />
        </dd>
      </div>

      <div className={styles.item}>
        <dt className={styles.label}>마감일</dt>
        <dd className={styles.value}>{formatTodoDate(todo.dueDate)}</dd>
      </div>

      <div className={styles.item}>
        <dt className={styles.label}>페이지 ID</dt>
        <dd className={styles.value}>{todo.id}</dd>
      </div>

      <div className={styles.item}>
        <dt className={styles.label}>링크</dt>
        <dd className={[styles.value, styles.muted].join(' ')}>/todos/{todo.id}</dd>
      </div>
    </dl>
  )
}
