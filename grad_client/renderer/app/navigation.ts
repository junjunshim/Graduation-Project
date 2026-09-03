import type { IconName } from '../design-system/primitives/Icon'

export type NavigationItem = {
  to: string
  label: string
  icon: IconName
  activePathPrefix?: string
  activePathPrefixes?: string[]
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
    activePathPrefixes: ['/workspace', '/setup/top-node'],
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
