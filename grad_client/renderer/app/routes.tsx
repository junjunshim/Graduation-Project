import { RouterProvider, createHashRouter } from 'react-router-dom'
import { HomePage } from '../features/home/pages/HomePage'
import { TodoDetailPage } from '../features/todo/pages/TodoDetailPage'
import { TodoListPage } from '../features/todo/pages/TodoListPage'
import { AppShell } from './layouts/AppShell'

const router = createHashRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'todos', element: <TodoListPage /> },
      { path: 'todos/:todoId', element: <TodoDetailPage /> },
    ],
  },
])

export function AppRoutes() {
  return <RouterProvider router={router} />
}
