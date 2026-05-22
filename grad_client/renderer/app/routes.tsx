import { Navigate, Outlet, RouterProvider, createHashRouter } from 'react-router-dom'
import { getCurrentUser } from '../features/auth/api'
import { LoginPage } from '../features/auth/pages/LoginPage'
import { SignupPage } from '../features/auth/pages/SignupPage'
import { DashboardPage } from '../features/dashboard/pages/DashboardPage'
import { OrgManagePage } from '../features/org/pages/OrgManagePage'
import { TopNodeSetupPage } from '../features/org/pages/TopNodeSetupPage'
import { WorkspacePage } from '../features/workspace/pages/WorkspacePage'
import { WorkItemCreatePage } from '../features/work-item/pages/WorkItemCreatePage'
import { WorkItemDetailPage } from '../features/work-item/pages/WorkItemDetailPage'
import { WorkItemEditPage } from '../features/work-item/pages/WorkItemEditPage'
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

const router = createHashRouter([
  {
    path: '/',
    element: <RootEntry />,
  },
  {
    element: <GuestOnly />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/signup', element: <SignupPage /> },
    ],
  },
  {
    element: <RequireSession />,
    children: [
      {
        path: '/',
        element: <AppShell />,
        children: [
          { path: '/dashboard', element: <DashboardPage /> },
          { path: '/workspace', element: <WorkspacePage /> },
          { path: '/setup/top-node', element: <TopNodeSetupPage /> },
          { path: '/org/manage', element: <OrgManagePage /> },
          {
            path: '/work-items',
            element: (
              <ShellPlaceholderPage
                eyebrow="Work Items"
                title="업무"
                description="등록된 업무를 모아 보는 화면을 준비 중입니다."
                actionLabel="업무 등록"
                actionTo="/work-items/new"
              />
            ),
          },
          { path: '/work-items/new', element: <WorkItemCreatePage /> },
          { path: '/work-items/:workItemId', element: <WorkItemDetailPage /> },
          { path: '/work-items/:workItemId/edit', element: <WorkItemEditPage /> },
          {
            path: '/calendar',
            element: (
              <ShellPlaceholderPage
                eyebrow="Calendar"
                title="캘린더"
                description="마감 일정과 업무 일정을 한 화면에서 볼 수 있도록 준비 중입니다."
              />
            ),
          },
          {
            path: '/documents',
            element: (
              <ShellPlaceholderPage
                eyebrow="Documents"
                title="문서"
                description="회의록과 업무 문서를 연결하는 공간을 준비 중입니다."
              />
            ),
          },
          {
            path: '/files',
            element: (
              <ShellPlaceholderPage
                eyebrow="Files"
                title="파일"
                description="업무별 첨부 파일과 자료를 정리하는 화면을 준비 중입니다."
              />
            ),
          },
          {
            path: '/settings',
            element: (
              <ShellPlaceholderPage
                eyebrow="Settings"
                title="설정"
                description="워크스페이스 환경과 계정 옵션을 관리하는 화면을 준비 중입니다."
              />
            ),
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
