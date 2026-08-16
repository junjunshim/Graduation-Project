import { Navigate, Outlet, RouterProvider, createHashRouter } from 'react-router-dom'
import { getCurrentUser } from '../features/auth/api'
import { AppShell } from './layouts/AppShell'
import { ShellPlaceholderPage } from './layouts/ShellPlaceholderPage'

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
  return null
}

const router = createHashRouter([
  {
    path: '/',
    element: <RootEntry />,
  },
  {
    element: <GuestOnly />,
    HydrateFallback: RouteHydrationFallback,
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
            element: <ShellPlaceholderPage />,
          },
          {
            path: '/files',
            element: <ShellPlaceholderPage />,
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
