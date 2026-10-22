import assert from 'node:assert/strict'
import test from 'node:test'
import {
  RECURRING_CATEGORY_OPTIONS,
  getRecurringCategoryLabel,
} from '../renderer/features/workspace/model/labels.js'

test('정기 일정 카테고리 코드를 한글 라벨로 변환한다', () => {
  for (const { value, label } of RECURRING_CATEGORY_OPTIONS) {
    assert.equal(getRecurringCategoryLabel(value), label)
  }
})

test('알 수 없는 카테고리는 원래 값을 유지한다', () => {
  assert.equal(getRecurringCategoryLabel('CUSTOM'), 'CUSTOM')
})

test('카테고리가 없으면 빈 문자열을 반환한다', () => {
  assert.equal(getRecurringCategoryLabel(null), '')
  assert.equal(getRecurringCategoryLabel(undefined), '')
})
