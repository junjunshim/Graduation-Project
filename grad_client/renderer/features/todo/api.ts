import type { TodoItem } from './types'

const todoList: TodoItem[] = [
  {
    id: 'temp',
    title: '예정 TODO',
    description: '예정 TODD 입니다.',
    status: 'planned',
    dueDate: '2026-03-19',
  },
  {
    id: 'temp',
    title: '예정 TODO',
    description: '예정 TODD 입니다.',
    status: 'planned',
    dueDate: '2026-03-19',
  },
  {
    id: 'temp',
    title: '진행중 TODO',
    description: '진행중 TODO 입니다.',
    status: 'in-progress',
    dueDate: '2026-03-19',
  },
  {
    id: 'temp',
    title: '진행중 TODO',
    description: '진행중 TODO 입니다.',
    status: 'in-progress',
    dueDate: '2026-03-19',
  },
  {
    id: 'temp',
    title: '완료 TODO',
    description: '완료 TODO 입니다.',
    status: 'done',
    dueDate: '2026-03-19',
  },
]

export function getTodos() {
  return todoList
}

export function getTodoById(id: string) {
  return todoList.find((todo) => todo.id === id)
}
