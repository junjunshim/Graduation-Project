import type { IconName } from '../design-system/primitives/Icon'

export type NavigationItem = {
  to: string
  label: string
  icon: IconName
  disabled?: boolean
  activePathPrefix?: string
  activePathPrefixes?: string[]
  /** 경로 패턴으로 선택 상태를 판단해야 할 때 사용한다 (예: 업무 상세/수정) */
  activePathPatterns?: RegExp[]
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
    // 업무 상세/수정 화면도 워크스페이스에 속한 화면이라 워크스페이스를 선택 상태로 둔다.
    activePathPatterns: [/^\/work-items\/[^/]+(\/edit)?\/?$/],
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
