import type { IconName } from '../../design-system/primitives/Icon'
import type { TodoStatus } from './types'

const dateFormatter = new Intl.DateTimeFormat('ko-KR', {
  month: 'long',
  day: 'numeric',
  weekday: 'short',
})

export const todoStatusMeta: Record<
  TodoStatus,
  { label: string; icon: IconName; tone: 'planned' | 'inProgress' | 'done' }
> = {
  planned: {
    label: '예정',
    icon: 'calendar',
    tone: 'planned',
  },
  'in-progress': {
    label: '진행중',
    icon: 'clock',
    tone: 'inProgress',
  },
  done: {
    label: '완료',
    icon: 'checkCircle',
    tone: 'done',
  },
}

export function getTodoStatusMeta(status: TodoStatus) {
  return todoStatusMeta[status]
}

export function formatTodoDate(value: string) {
  return dateFormatter.format(new Date(`${value}T00:00:00`))
}
