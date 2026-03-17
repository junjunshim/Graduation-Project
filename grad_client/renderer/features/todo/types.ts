export type TodoStatus = 'planned' | 'in-progress' | 'done'

export type TodoItem = {
  id: string
  title: string
  description: string
  status: TodoStatus
  dueDate: string
}
