import type { IconName } from '../design-system/primitives/Icon'

export type NavigationItem = {
  to: string
  label: string
  end?: boolean
  icon: IconName
  section: 'workspace' | 'database'
}

export const navigationSections = [
  { id: 'workspace', label: '워크스페이스' },
  { id: 'database', label: '데이터베이스' },
] as const

export const navigationItems: NavigationItem[] = [
  { to: '/', label: '홈', end: true, icon: 'home', section: 'workspace' },
  { to: '/todos', label: '할 일', icon: 'database', section: 'database' },
]
