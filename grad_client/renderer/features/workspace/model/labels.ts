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

// 10가지 세련된 역할 뱃지 컬러 팔레트 (HEX)
const ROLE_PALETTE: { bg: string; color: string; border: string }[] = [
  { bg: 'rgba(99, 102, 241, 0.16)', color: '#818cf8', border: 'rgba(99, 102, 241, 0.35)' }, // 0. 인디고 (Indigo)
  { bg: 'rgba(139, 92, 246, 0.16)', color: '#a78bfa', border: 'rgba(139, 92, 246, 0.35)' }, // 1. 퍼플 (Purple)
  { bg: 'rgba(217, 70, 239, 0.16)', color: '#e879f9', border: 'rgba(217, 70, 239, 0.35)' }, // 2. 푸시아 (Fuchsia)
  { bg: 'rgba(59, 130, 246, 0.16)', color: '#60a5fa', border: 'rgba(59, 130, 246, 0.35)' },  // 3. 블루 (Blue)
  { bg: 'rgba(14, 165, 233, 0.16)', color: '#38bdf8', border: 'rgba(14, 165, 233, 0.35)' },  // 4. 스카이블루 (Sky)
  { bg: 'rgba(6, 182, 212, 0.16)',  color: '#22d3ee', border: 'rgba(6, 182, 212, 0.35)' },  // 5. 시안 (Cyan)
  { bg: 'rgba(16, 185, 129, 0.16)', color: '#34d399', border: 'rgba(16, 185, 129, 0.35)' }, // 6. 에메랄드 (Emerald)
  { bg: 'rgba(245, 158, 11, 0.16)', color: '#fbbf24', border: 'rgba(245, 158, 11, 0.35)' }, // 7. 앰버 (Amber)
  { bg: 'rgba(249, 115, 22, 0.16)', color: '#fb923c', border: 'rgba(249, 115, 22, 0.35)' }, // 8. 오렌지 (Orange)
  { bg: 'rgba(148, 163, 184, 0.16)', color: '#cbd5e1', border: 'rgba(148, 163, 184, 0.35)' }, // 9. 슬레이트 (Slate)
]

// ADMIN 전용 레드 스타일
const ADMIN_STYLE = {
  bg: 'rgba(239, 68, 68, 0.18)',
  color: '#f87171',
  border: 'rgba(239, 68, 68, 0.4)',
}

/**
 * 역할 이름을 해싱 후 % 10 하여 10개 컬러 중 일관된 스타일을 반환합니다.
 * ADMIN은 항상 고정된 빨간색 스타일을 반환합니다.
 */
export function getRoleBadgeStyle(roleName: string): React.CSSProperties {
  const normalized = (roleName || '').trim().toUpperCase()

  if (normalized === 'ADMIN') {
    return {
      backgroundColor: ADMIN_STYLE.bg,
      color: ADMIN_STYLE.color,
      border: `1px solid ${ADMIN_STYLE.border}`,
    }
  }

  // 문자열 해시 계산 (djb2 기반)
  let hash = 0
  for (let i = 0; i < normalized.length; i += 1) {
    hash = (hash << 5) - hash + normalized.charCodeAt(i)
    hash |= 0 // 32비트 정수로 변환
  }

  const index = Math.abs(hash) % ROLE_PALETTE.length
  const palette = ROLE_PALETTE[index]

  return {
    backgroundColor: palette.bg,
    color: palette.color,
    border: `1px solid ${palette.border}`,
  }
}
