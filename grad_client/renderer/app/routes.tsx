import { Navigate, Outlet, RouterProvider, createHashRouter, useRouteError } from 'react-router-dom'
import { getCurrentUser } from '../features/auth/api'
import { AppShell } from './layouts/AppShell'
import { ShellPlaceholderPage } from './layouts/ShellPlaceholderPage'
import styles from './RouteState.module.css'

function RootEntry() {
  const currentUser = getCurrentUser()

  return <Navigate to={currentUser ? '/dashboard' : '/login'} replace />
}

function RequireSession() {
  const currentUser = getCurrentUser()

  if (!currentUser) {
    return <Navigate to="/login" replace />
  }

  return <Outlet />
}

function GuestOnly() {
  const currentUser = getCurrentUser()

  if (currentUser) {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}

function RouteHydrationFallback() {
  return (
    <main className={styles.page} aria-busy="true" aria-live="polite">
      <div className={styles.card}>
        <h1>화면을 불러오는 중입니다.</h1>
        <p>필요한 화면 코드를 준비하고 있습니다.</p>
      </div>
    </main>
  )
}

function RouteErrorFallback() {
  const error = useRouteError()
  const message = error instanceof Error ? error.message : '화면을 표시하지 못했습니다.'

  return (
    <main className={styles.page}>
      <div className={styles.card} role="alert">
        <h1>화면을 불러오지 못했습니다.</h1>
        <p>{message}</p>
        <button type="button" className={styles.action} onClick={() => window.location.reload()}>
          다시 불러오기
        </button>
      </div>
    </main>
  )
}

const router = createHashRouter([
  {
    path: '/',
    element: <RootEntry />,
    errorElement: <RouteErrorFallback />,
  },
  {
    element: <GuestOnly />,
    HydrateFallback: RouteHydrationFallback,
    errorElement: <RouteErrorFallback />,
    children: [
      {
        path: '/login',
        lazy: async () => {
          const { LoginPage } = await import('../features/auth/pages/LoginPage')
          return { Component: LoginPage }
        },
      },
      {
        path: '/signup',
        lazy: async () => {
          const { SignupPage } = await import('../features/auth/pages/SignupPage')
          return { Component: SignupPage }
        },
      },
    ],
  },
  {
    element: <RequireSession />,
    HydrateFallback: RouteHydrationFallback,
    errorElement: <RouteErrorFallback />,
    children: [
      {
        path: '/',
        element: <AppShell />,
        children: [
          {
            path: '/dashboard',
            lazy: async () => {
              const { DashboardPage } = await import('../features/dashboard/pages/DashboardPage')
              return { Component: DashboardPage }
            },
          },
          {
            path: '/workspace/select',
            lazy: async () => {
              const { WorkspaceEntryPage } = await import('../features/workspace/pages/WorkspaceEntryPage')
              return { Component: WorkspaceEntryPage }
            },
          },
          {
            path: '/workspace',
            lazy: async () => {
              const { WorkspacePage } = await import('../features/workspace/pages/WorkspacePage')
              return { Component: WorkspacePage }
            },
          },
          {
            path: '/setup/top-node',
            lazy: async () => {
              const { TopNodeSetupPage } = await import('../features/org/pages/TopNodeSetupPage')
              return { Component: TopNodeSetupPage }
            },
          },
          {
            path: '/org/manage',
            lazy: async () => {
              const { OrgManagePage } = await import('../features/org/pages/OrgManagePage')
              return { Component: OrgManagePage }
            },
          },
          {
            path: '/work-items',
            lazy: async () => {
              const { WorkItemsPage } = await import('../features/work-item/pages/WorkItemsPage')
              return { Component: WorkItemsPage }
            },
          },
          {
            path: '/work-items/new',
            lazy: async () => {
              const { WorkItemCreatePage } = await import('../features/work-item/pages/WorkItemCreatePage')
              return { Component: WorkItemCreatePage }
            },
          },
          {
            path: '/work-items/:workItemId',
            lazy: async () => {
              const { WorkItemDetailPage } = await import('../features/work-item/pages/WorkItemDetailPage')
              return { Component: WorkItemDetailPage }
            },
          },
          {
            path: '/work-items/:workItemId/edit',
            lazy: async () => {
              const { WorkItemEditPage } = await import('../features/work-item/pages/WorkItemEditPage')
              return { Component: WorkItemEditPage }
            },
          },
          {
            path: '/calendar',
            element: <ShellPlaceholderPage />,
          },
          {
            path: '/documents',
            element: <Navigate to="/workspace?view=files" replace />,
          },
          {
            path: '/files',
            element: <Navigate to="/workspace?view=files" replace />,
          },
          {
            path: '/settings',
            element: <ShellPlaceholderPage />,
          },
        ],
      },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
])

export function AppRoutes() {
  return <RouterProvider router={router} />
}
