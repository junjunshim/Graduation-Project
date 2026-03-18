import { Link } from 'react-router-dom'
import { Icon } from '../../../design-system/primitives/Icon'
import type { TodoItem } from '../types'
import { formatTodoDate } from '../utils'
import { TodoStatusBadge } from './TodoStatusBadge'
import styles from './TodoDatabaseRow.module.css'

type TodoDatabaseRowProps = {
  todo: TodoItem
}

export function TodoDatabaseRow({ todo }: TodoDatabaseRowProps) {
  return (
    <Link to={`/todos/${todo.id}`} className={styles.row}>
      <div className={styles.primaryCell}>
        <strong className={styles.title}>{todo.title}</strong>
        <span className={styles.description}>{todo.description}</span>
      </div>

      <div className={styles.cell}>
        <TodoStatusBadge status={todo.status} />
      </div>

      <div className={styles.cell}>
        <span className={styles.date}>{formatTodoDate(todo.dueDate)}</span>
      </div>

      <div className={[styles.cell, styles.arrow].join(' ')}>
        <Icon name="chevronRight" size={16} />
      </div>
    </Link>
  )
}
