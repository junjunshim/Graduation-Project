import type { RecurringCategory } from './recurringRuleTypes'
import type { NodeType, WorkItemStatus } from './types'

export function getWorkItemStatusLabel(status: WorkItemStatus) {
  if (status === 'todo') {
    return '예정'
  }

  if (status === 'in-progress') {
    return '진행 중'
  }

  return '완료'
}

export function getWorkItemStatusTone(status: WorkItemStatus) {
  if (status === 'todo') {
    return 'todo' as const
  }

  if (status === 'in-progress') {
    return 'inProgress' as const
  }

  return 'done' as const
}

export type WorkItemPriorityLevel = 1 | 2 | 3 | 4 | 5
export type WorkItemPriorityTone = 'highest' | 'high' | 'medium' | 'low' | 'lowest'

export interface WorkItemPriorityMeta {
  level: WorkItemPriorityLevel
  label: string
  symbol: string
  tone: WorkItemPriorityTone
}

export function getWorkItemPriorityMeta(priority: number): WorkItemPriorityMeta {
  if (priority <= 1) {
    return { level: 1, label: '매우 높음', symbol: '↑↑', tone: 'highest' }
  }
  if (priority === 2) {
    return { level: 2, label: '높음', symbol: '↑', tone: 'high' }
  }
  if (priority === 3) {
    return { level: 3, label: '보통', symbol: '−', tone: 'medium' }
  }
  if (priority === 4) {
    return { level: 4, label: '낮음', symbol: '↓', tone: 'low' }
  }
  return { level: 5, label: '매우 낮음', symbol: '↓↓', tone: 'lowest' }
}

export function getNodeTypeLabel(nodeType: NodeType) {
  if (typeof nodeType === 'string' && nodeType.startsWith('CUSTOM:')) {
    const parts = nodeType.split(':')
    return parts[1] || '사용자 지정'
  }

  switch (nodeType) {
    case 'USER':
      return '개인공간'
    case 'COMPANY':
      return '회사'
    case 'DIVISION':
      return '본부'
    case 'DEPARTMENT':
      return '부서'
    case 'TEAM':
      return '팀'
    case 'PROJECT':
      return '프로젝트'
    default:
      return nodeType
  }
}

/** 정기 일정 카테고리 (선택 옵션·상세·뱃지에서 공통 사용) */
export const RECURRING_CATEGORY_OPTIONS: ReadonlyArray<{ value: RecurringCategory; label: string }> = [
  { value: 'ROUTINE', label: '정기 루틴' },
  { value: 'REPORT', label: '정기 보고' },
  { value: 'INSPECTION', label: '시스템 점검' },
  { value: 'MEETING', label: '정기 회의' },
  { value: 'EVENT', label: '조직 행사' },
]

export function getRecurringCategoryLabel(category: RecurringCategory | string | null | undefined) {
  return RECURRING_CATEGORY_OPTIONS.find((option) => option.value === category)?.label ?? category ?? ''
}

// 32가지 톤온톤 뮤티드 역할/카테고리 뱃지 컬러 팔레트 (CSS 토큰 변수 매핑)
const PALETTE_COUNT = 32
const MAX_BADGE_STYLE_CACHE_SIZE = 256

const NEUTRAL_CATEGORY_BADGE_STYLE: React.CSSProperties = Object.freeze({
  backgroundColor: 'var(--axis-status-neutral-soft, #ECE9E2)',
  color: 'var(--axis-status-neutral, #6B665E)',
  border: '1px solid var(--axis-status-neutral-border, #DCD7CE)',
})
const ADMIN_ROLE_BADGE_STYLE: React.CSSProperties = Object.freeze({
  backgroundColor: 'var(--axis-status-danger-soft, #FBECE9)',
  color: 'var(--axis-status-danger, #A83B2E)',
  border: '1px solid var(--axis-status-danger-border, #F1CEC9)',
})
const categoryBadgeStyleCache = new Map<string, React.CSSProperties>()
const roleBadgeStyleCache = new Map<string, React.CSSProperties>()

const PALETTE_BADGE_STYLES: ReadonlyArray<React.CSSProperties> = Object.freeze(
  Array.from({ length: PALETTE_COUNT }, (_, index) =>
    Object.freeze({
      backgroundColor: `var(--axis-palette-${index}-bg)`,
      color: `var(--axis-palette-${index}-text)`,
      border: `1px solid var(--axis-palette-${index}-border)`,
    }),
  ),
)

function getPaletteStyleByIndex(index: number): React.CSSProperties {
  const safeIndex = Math.abs(index) % PALETTE_COUNT
  return PALETTE_BADGE_STYLES[safeIndex]
}

function getPaletteStyleForText(value: string) {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i)
    hash |= 0
  }

  return getPaletteStyleByIndex(hash)
}

function getCachedBadgeStyle(
  cache: Map<string, React.CSSProperties>,
  cacheKey: string,
  createStyle: () => React.CSSProperties,
) {
  const cachedStyle = cache.get(cacheKey)
  if (cachedStyle) {
    return cachedStyle
  }

  const style = Object.freeze(createStyle())
  if (cache.size >= MAX_BADGE_STYLE_CACHE_SIZE) {
    const oldestKey = cache.keys().next().value
    if (oldestKey !== undefined) {
      cache.delete(oldestKey)
    }
  }
  cache.set(cacheKey, style)

  return style
}

/**
 * 역할 이름을 해싱 후 % 32 하여 32개 톤온톤 뮤티드 컬러 중 일관된 스타일을 반환합니다.
 * ADMIN(또는 isTopRole)은 통일된 danger(테라코타) 시맨틱 뱃지 토큰을 반환합니다.
 */
export function getRoleBadgeStyle(roleName: string, isTopRole = false): React.CSSProperties {
  const normalized = (roleName || '').trim().toUpperCase()

  if (isTopRole || normalized === 'ADMIN') {
    return ADMIN_ROLE_BADGE_STYLE
  }

  return getCachedBadgeStyle(roleBadgeStyleCache, normalized, () =>
    getPaletteStyleForText(normalized),
  )
}

/**
 * 카테고리 이름을 해싱 후 % 32 하여 32개 컬러 중 일관된 스타일을 반환합니다.
 */
export function getCategoryBadgeStyle(categoryName: string): React.CSSProperties {
  const normalized = (categoryName || '').trim()

  if (!normalized) {
    return NEUTRAL_CATEGORY_BADGE_STYLE
  }

  return getCachedBadgeStyle(categoryBadgeStyleCache, normalized, () =>
    getPaletteStyleForText(normalized),
  )
}
