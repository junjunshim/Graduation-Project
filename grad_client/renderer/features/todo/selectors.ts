import type { TodoItem, TodoStatus } from './types'

export type TodoStats = {
  total: number
  planned: number
  inProgress: number
  done: number
  completionRate: number
  dueThisWeek: number
}

function parseTodoDate(value: string) {
  return new Date(`${value}T00:00:00`)
}

export function sortTodosByDueDate(todos: TodoItem[]) {
  return [...todos].sort(
    (left, right) => parseTodoDate(left.dueDate).getTime() - parseTodoDate(right.dueDate).getTime(),
  )
}

export function getTodosByStatus(todos: TodoItem[], status: TodoStatus) {
  return todos.filter((todo) => todo.status === status)
}

export function getUpcomingTodos(todos: TodoItem[], limit = 4) {
  return sortTodosByDueDate(todos).filter((todo) => todo.status !== 'done').slice(0, limit)
}

export function getRecentTodos(todos: TodoItem[], limit = 4) {
  return todos.slice(0, limit)
}

export function getTodoStats(todos: TodoItem[]): TodoStats {
  const planned = getTodosByStatus(todos, 'planned').length
  const inProgress = getTodosByStatus(todos, 'in-progress').length
  const done = getTodosByStatus(todos, 'done').length
  const total = todos.length

  const now = new Date()
  now.setHours(0, 0, 0, 0)

  const inAWeek = new Date(now)
  inAWeek.setDate(inAWeek.getDate() + 7)

  const dueThisWeek = todos.filter((todo) => {
    const dueDate = parseTodoDate(todo.dueDate)

    return todo.status !== 'done' && dueDate >= now && dueDate <= inAWeek
  }).length

  return {
    total,
    planned,
    inProgress,
    done,
    completionRate: total === 0 ? 0 : Math.round((done / total) * 100),
    dueThisWeek,
  }
}
