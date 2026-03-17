export type NavigationItem = {
  to: string
  label: string
  end?: boolean
}

export const navigationItems: NavigationItem[] = [
  { to: '/', label: '홈', end: true },
  { to: '/todos', label: '할 일' },
]
