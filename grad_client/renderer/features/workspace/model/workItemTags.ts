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
  const tagId = TEMPORARY_WORK_ITEM_TAGS[item.workItemId]

  if (!tagId) {
    return null
  }

  return {
    id: tagId,
    ...WORK_ITEM_TAGS[tagId],
  }
}
