import { Icon } from '../../../design-system/primitives/Icon'
import type { TodoStatus } from '../types'
import { getTodoStatusMeta } from '../utils'
import styles from './TodoStatusBadge.module.css'

type TodoStatusBadgeProps = {
  status: TodoStatus
}

export function TodoStatusBadge({ status }: TodoStatusBadgeProps) {
  const meta = getTodoStatusMeta(status)

  return (
    <span className={[styles.badge, styles[meta.tone]].join(' ')}>
      <Icon name={meta.icon} size={14} className={styles.icon} />
      <span>{meta.label}</span>
    </span>
  )
}
