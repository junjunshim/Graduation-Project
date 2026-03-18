import { getTodos } from '../../todo/api'
import {
  getRecentTodos,
  getTodoStats,
  getTodosByStatus,
  getUpcomingTodos,
} from '../../todo/selectors'
import { HomeOverview } from '../components/HomeOverview'
import { HomeTaskPanels } from '../components/HomeTaskPanels'
import styles from './HomePage.module.css'

export function HomePage() {
  const todos = getTodos()
  const stats = getTodoStats(todos)
  const upcomingTodos = getUpcomingTodos(todos, 4)
  const recentTodos = getRecentTodos(todos, 4)

  return (
    <section className={styles.page}>
      <HomeOverview
        stats={stats}
        focusTodoId={upcomingTodos[0]?.id}
      />
      <HomeTaskPanels
        upcomingTodos={upcomingTodos}
        recentTodos={recentTodos}
        plannedTodos={getTodosByStatus(todos, 'planned').slice(0, 3)}
        inProgressTodos={getTodosByStatus(todos, 'in-progress').slice(0, 3)}
        doneTodos={getTodosByStatus(todos, 'done').slice(0, 3)}
      />
    </section>
  )
}
