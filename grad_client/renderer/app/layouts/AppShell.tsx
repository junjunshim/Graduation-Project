import { Link, NavLink, Outlet, matchPath, useLocation } from 'react-router-dom'
import { getTodoById, getTodos } from '../../features/todo/api'
import { getTodoStats } from '../../features/todo/selectors'
import { formatTodoDate } from '../../features/todo/utils'
import { Icon } from '../../design-system/primitives/Icon'
import { navigationItems, navigationSections } from '../navigation'
import styles from './AppShell.module.css'

function getPageMeta(pathname: string) {
  const todoDetailMatch = matchPath('/todos/:todoId', pathname)

  if (pathname === '/') {
    return {
      eyebrow: 'Workspace',
      title: '오늘의 작업 공간',
      description: '요약 카드와 우선순위 목록으로 현재 흐름을 빠르게 확인하세요.',
      icon: 'sparkles' as const,
      actionLabel: '할 일 열기',
      actionTo: '/todos',
    }
  }

  if (todoDetailMatch) {
    const currentTodo = todoDetailMatch.params.todoId
      ? getTodoById(todoDetailMatch.params.todoId)
      : undefined

    return {
      eyebrow: 'Page',
      title: currentTodo?.title ?? '할 일 상세',
      description: '문서 본문과 속성 패널을 같은 페이지에서 정리합니다.',
      icon: 'page' as const,
      actionLabel: '데이터베이스로 돌아가기',
      actionTo: '/todos',
    }
  }

  return {
    eyebrow: 'Database',
    title: '할 일 데이터베이스',
    description: '상태, 일정, 설명을 한 화면에서 관리하는 목록입니다.',
    icon: 'database' as const,
    actionLabel: '워크스페이스 보기',
    actionTo: '/',
  }
}

export function AppShell() {
  const location = useLocation()
  const pageMeta = getPageMeta(location.pathname)
  const stats = getTodoStats(getTodos())
  const todayLabel = formatTodoDate(new Date().toISOString().slice(0, 10))

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brandCard}>
          <div className={styles.brandMark}>GP</div>
          <div className={styles.brandText}>
            <p className={styles.eyebrow}>Graduation Project</p>
            <h1 className={styles.title}>Grad Client</h1>
          </div>
        </div>

        <Link to="/todos" className={styles.searchLink}>
          <Icon name="search" size={16} />
          <span>빠르게 열기</span>
          <span className={styles.searchHint}>Ctrl K</span>
        </Link>

        <nav className={styles.navigation} aria-label="주요 메뉴">
          {navigationSections.map((section) => (
            <section key={section.id} className={styles.navSection}>
              <p className={styles.navSectionTitle}>{section.label}</p>
              <div className={styles.navList}>
                {navigationItems
                  .filter((item) => item.section === section.id)
                  .map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        [styles.navItem, isActive ? styles.navItemActive : '']
                          .filter(Boolean)
                          .join(' ')
                      }
                    >
                      <span className={styles.navIcon}>
                        <Icon name={item.icon} size={16} />
                      </span>
                      <span className={styles.navLabel}>{item.label}</span>
                    </NavLink>
                  ))}
              </div>
            </section>
          ))}
        </nav>

        <div className={styles.sidebarCard}>
          <p className={styles.sidebarCardEyebrow}>이번 주 진행률</p>
          <strong className={styles.sidebarCardValue}>{stats.completionRate}%</strong>
          <p className={styles.sidebarCardText}>
            총 {stats.total}개 중 {stats.done}개 완료, {stats.dueThisWeek}개가 이번 주 안에
            마감됩니다.
          </p>
          <div className={styles.sidebarCardFooter}>
            <span>진행중 {stats.inProgress}</span>
            <span>예정 {stats.planned}</span>
          </div>
        </div>
      </aside>

      <div className={styles.workspace}>
        <header className={styles.pageBar}>
          <div className={styles.pageBarMain}>
            <span className={styles.pageIcon}>
              <Icon name={pageMeta.icon} size={18} />
            </span>
            <div className={styles.pageMeta}>
              <p className={styles.pageEyebrow}>{pageMeta.eyebrow}</p>
              <h2 className={styles.pageTitle}>{pageMeta.title}</h2>
              <p className={styles.pageDescription}>{pageMeta.description}</p>
            </div>
          </div>

          <div className={styles.pageBarActions}>
            <div className={styles.dateChip}>
              <Icon name="calendar" size={15} />
              <span>{todayLabel}</span>
            </div>
            <Link to={pageMeta.actionTo} className={styles.pageAction}>
              {pageMeta.actionLabel}
            </Link>
          </div>
        </header>

        <main className={styles.main}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
