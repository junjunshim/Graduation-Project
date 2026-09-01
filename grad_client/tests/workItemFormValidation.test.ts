import assert from 'node:assert/strict'
import test from 'node:test'
import { getWorkItemDateRangeError } from '../renderer/features/work-item/model/workItemFormValidation.js'

test('work item date validation rejects only reversed complete ranges', () => {
  assert.equal(getWorkItemDateRangeError('', '2026-08-29'), null)
  assert.equal(getWorkItemDateRangeError('2026-08-29', ''), null)
  assert.equal(getWorkItemDateRangeError('2026-08-29', '2026-08-29'), null)
  assert.equal(getWorkItemDateRangeError('2026-08-30', '2026-08-29'), '마감일은 시작일보다 빠를 수 없습니다.')
})
