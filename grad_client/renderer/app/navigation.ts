import type { IconName } from '../design-system/primitives/Icon'

export type NavigationItem = {
  to: string
  label: string
  icon: IconName
  activePathPrefix?: string
}

export const navigationItems: NavigationItem[] = [
  {
    to: '/dashboard',
    label: '대시보드',
    icon: 'home',
  },
  {
    to: '/workspace/select',
    label: '워크스페이스',
    icon: 'folder',
    activePathPrefix: '/workspace',
  },
  {
    to: '/work-items',
    label: '업무',
    icon: 'checkSquare',
  },
  {
    to: '/calendar',
    label: '캘린더',
    icon: 'calendar',
  },
  {
    to: '/documents',
    label: '문서',
    icon: 'page',
  },
  {
    to: '/files',
    label: '파일',
    icon: 'folder',
  },
  {
    to: '/settings',
    label: '설정',
    icon: 'gear',
  },
]
