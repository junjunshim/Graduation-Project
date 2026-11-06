import assert from 'node:assert/strict'
import test from 'node:test'
import { getWorkItemListHref } from '../renderer/features/work-item/model/workItemNavigation.js'

test('업무 목록 복귀 경로는 진입한 워크스페이스 nodeId를 유지한다', () => {
  assert.equal(getWorkItemListHref(7), '/workspace?view=tasks&nodeId=7')
  assert.equal(getWorkItemListHref('7'), '/workspace?view=tasks&nodeId=7')
})

test('워크스페이스 문맥이 없거나 잘못된 nodeId면 전체 업무 목록으로 복귀한다', () => {
  assert.equal(getWorkItemListHref(), '/work-items')
  assert.equal(getWorkItemListHref(null), '/work-items')
  assert.equal(getWorkItemListHref(''), '/work-items')
  assert.equal(getWorkItemListHref('abc'), '/work-items')
  assert.equal(getWorkItemListHref(0), '/work-items')
})
