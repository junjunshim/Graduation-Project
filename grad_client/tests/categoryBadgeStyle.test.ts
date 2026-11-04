import assert from 'node:assert/strict'
import test from 'node:test'
import { getCategoryBadgeStyle } from '../renderer/features/workspace/model/labels.js'

test('같은 카테고리는 공백을 정리한 캐시 스타일을 재사용한다', () => {
  const first = getCategoryBadgeStyle('기획')
  const second = getCategoryBadgeStyle('  기획  ')

  assert.equal(first, second)
})

test('빈 카테고리는 동일한 중립 배지 스타일을 사용한다', () => {
  const empty = getCategoryBadgeStyle('')
  const blank = getCategoryBadgeStyle('   ')

  assert.equal(empty, blank)
  assert.equal(empty.backgroundColor, 'var(--axis-status-neutral-soft, #ECE9E2)')
})

test('서로 다른 카테고리는 서로 다른 스타일 객체를 사용한다', () => {
  const planning = getCategoryBadgeStyle('기획')
  const research = getCategoryBadgeStyle('조사')

  assert.notEqual(planning, research)
})
