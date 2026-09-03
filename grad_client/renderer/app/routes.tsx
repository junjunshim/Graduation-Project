import { Navigate, Outlet, RouterProvider, createHashRouter, useRouteError } from 'react-router-dom'
import { getCurrentUser } from '../features/auth/api'
import { AppShell } from './layouts/AppShell'
import { ShellPlaceholderPage } from './layouts/ShellPlaceholderPage'
import { DashboardPage } from '../features/dashboard/pages/DashboardPage'
import { WorkspacePage } from '../features/workspace/pages/WorkspacePage'
import { WorkspaceEntryPage } from '../features/workspace/pages/WorkspaceEntryPage'
import { OrgManagePage } from '../features/org/pages/OrgManagePage'
import { WorkItemsPage } from '../features/work-item/pages/WorkItemsPage'
import { WorkItemDetailPage } from '../features/work-item/pages/WorkItemDetailPage'
import { LoginPage } from '../features/auth/pages/LoginPage'
import { SignupPage } from '../features/auth/pages/SignupPage'
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
        element: <LoginPage />,
      },
      {
        path: '/signup',
        element: <SignupPage />,
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
            element: <DashboardPage />,
          },
          {
            path: '/workspace/select',
            element: <WorkspaceEntryPage />,
          },
          {
            path: '/workspace',
            element: <WorkspacePage />,
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
            element: <OrgManagePage />,
          },
          {
            path: '/work-items',
            element: <WorkItemsPage />,
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
            element: <WorkItemDetailPage />,
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
