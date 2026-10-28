import assert from 'node:assert/strict'
import test from 'node:test'
import { getWorkItemTag } from '../renderer/features/workspace/model/workItemTags.js'
import type { WorkItemRecord } from '../renderer/features/workspace/model/types.js'

function createWorkItem(category: string | undefined, workItemId = 'WI-999'): WorkItemRecord {
  return { workItemId, category } as WorkItemRecord
}

test('한글 카테고리 라벨을 정적 태그 인덱스로 조회한다', () => {
  const tag = getWorkItemTag(createWorkItem('기획'))

  assert.equal(tag?.id, 'planning')
  assert.equal(tag?.label, '기획')
  assert.equal(tag?.tone, 'purple')
})

test('영문 태그 키를 직접 조회한다', () => {
  const tag = getWorkItemTag(createWorkItem('RESEARCH'))

  assert.equal(tag?.id, 'research')
  assert.equal(tag?.label, '조사')
  assert.equal(tag?.tone, 'blue')
})

test('알 수 없는 카테고리는 기존 fallback 태그를 유지한다', () => {
  const tag = getWorkItemTag(createWorkItem('운영'))

  assert.equal(tag?.id, '운영')
  assert.equal(tag?.label, '운영')
  assert.equal(tag?.tone, 'blue')
})

test('카테고리가 없으면 업무별 임시 태그를 사용한다', () => {
  const tag = getWorkItemTag(createWorkItem(undefined, 'WI-1'))

  assert.equal(tag?.id, 'planning')
  assert.equal(tag?.label, '기획')
})
