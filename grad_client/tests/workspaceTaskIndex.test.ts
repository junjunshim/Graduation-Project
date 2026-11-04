import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildMemberNameLookup,
  groupWorkItemsByStatus,
} from '../renderer/features/workspace/model/workspaceTaskIndex.js'
import type { WorkItemStatus } from '../renderer/features/workspace/model/types.js'

test('member names are indexed by user id and email with the first match winning', () => {
  const lookup = buildMemberNameLookup([
    { userId: 'U-1', name: 'First User', email: 'first@example.com' },
    { userId: 'U-2', name: 'Second User' },
    { userId: 'U-1', name: 'Duplicate User', email: 'duplicate@example.com' },
  ])

  assert.equal(lookup.get('U-1'), 'First User')
  assert.equal(lookup.get('first@example.com'), 'First User')
  assert.equal(lookup.get('U-2'), 'Second User')
  assert.equal(lookup.get('duplicate@example.com'), 'Duplicate User')
})

test('work items are grouped by status in one pass while preserving order', () => {
  const items: Array<{ id: string; status: WorkItemStatus }> = [
    { id: 'A', status: 'todo' },
    { id: 'B', status: 'done' },
    { id: 'C', status: 'todo' },
    { id: 'D', status: 'in-progress' },
  ]
  const grouped = groupWorkItemsByStatus(items)

  assert.deepEqual(grouped.todo.map((item) => item.id), ['A', 'C'])
  assert.deepEqual(grouped.done.map((item) => item.id), ['B'])
  assert.deepEqual(grouped['in-progress'].map((item) => item.id), ['D'])
})

test('empty work item lists still receive all status buckets', () => {
  const grouped = groupWorkItemsByStatus([])

  assert.deepEqual(grouped, { 'in-progress': [], todo: [], done: [] })
})
