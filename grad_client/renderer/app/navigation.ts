import type { IconName } from '../design-system/primitives/Icon'

export type NavigationItem = {
  to: string
  label: string
  icon: IconName
  disabled?: boolean
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
    activePathPrefixes: ['/workspace', '/setup/top-node', '/setup/sub-node'],
  },
  {
    to: '/channels',
    label: '채널',
    icon: 'messageCircle',
    disabled: true,
  },
  {
    to: '/calendar',
    label: '캘린더',
    icon: 'calendar',
  },
  {
    to: '/settings',
    label: '설정',
    icon: 'gear',
  },
]
