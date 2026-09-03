import type { WorkItemRecord } from './types'

export const WORK_ITEM_TAGS = {
  planning: { label: '기획', tone: 'purple' },
  research: { label: '조사', tone: 'blue' },
  design: { label: '디자인', tone: 'green' },
  document: { label: '문서', tone: 'gray' },
  review: { label: '검수', tone: 'sky' },
  release: { label: '배포', tone: 'orange' },
} as const

export type WorkItemTagId = keyof typeof WORK_ITEM_TAGS

/**
 * 임시 업무별 태그
 * 서버 연동 이후에 getWorkItemTag 내부의 데이터 소스만 교체
 */
export const TEMPORARY_WORK_ITEM_TAGS: Partial<Record<string, WorkItemTagId>> = {
  'WI-1': 'planning',
  'WI-2': 'research',
  'WI-3': 'design',
  'WI-4': 'review',
  'WI-5': 'document',
  'WI-6': 'release',
  'WI-7': 'document',
  'WI-8': 'release',
  '5678': 'planning',
  '0704': 'research',
}

export function getWorkItemTag(item: WorkItemRecord) {
  if (item.category && item.category.trim()) {
    const rawCategory = item.category.trim().toLowerCase()
    // 직접 매칭되는 태그 키 확인
    if (rawCategory in WORK_ITEM_TAGS) {
      const key = rawCategory as WorkItemTagId
      return { id: key, ...WORK_ITEM_TAGS[key] }
    }

    // 한글 레이블 매칭 확인
    const foundEntry = Object.entries(WORK_ITEM_TAGS).find(
      ([, tag]) => tag.label === item.category?.trim(),
    )
    if (foundEntry) {
      return { id: foundEntry[0] as WorkItemTagId, ...foundEntry[1] }
    }

    // 커스텀 카테고리 문자열인 경우 기본 태그 톤 반환
    return {
      id: rawCategory as WorkItemTagId,
      label: item.category.trim(),
      tone: 'blue' as const,
    }
  }

  const tagId = TEMPORARY_WORK_ITEM_TAGS[item.workItemId]

  if (!tagId) {
    return null
  }

  return {
    id: tagId,
    ...WORK_ITEM_TAGS[tagId],
  }
}
