import type { IconName } from '../design-system/primitives/Icon'

export type NavigationItem = {
  to: string
  label: string
  description: string
  icon: IconName
}

export const navigationItems: NavigationItem[] = [
  {
    to: '/dashboard',
    label: '대시보드',
    description: '내 업무와 마감 임박 확인',
    icon: 'home',
  },
  {
    to: '/org/manage',
    label: '조직 관리',
    description: '조직 구조와 권한 관리',
    icon: 'database',
  },
  {
    to: '/work-items/new',
    label: '업무 등록',
    description: '새 업무 등록',
    icon: 'page',
  },
]
