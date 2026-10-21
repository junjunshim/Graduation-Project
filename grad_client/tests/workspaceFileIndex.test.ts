import assert from 'node:assert/strict'
import test from 'node:test'
import { groupFilesByWorkItem } from '../renderer/features/workspace/model/workspaceFileIndex.js'

const workItems = [
  { workItemId: 'WI-1' },
  { workItemId: 'WI-2' },
  { workItemId: 'WI-3' },
]

const files = [
  { workItemId: 'WI-1', isDeleted: false, name: 'first.txt' },
  { workItemId: 'WI-2', isDeleted: true, name: 'deleted.txt' },
  { workItemId: 'WI-1', isDeleted: false, name: 'second.txt' },
  { workItemId: 'UNKNOWN', isDeleted: false, name: 'orphan.txt' },
]

test('active work item files are grouped in one pass with their original order', () => {
  const grouped = groupFilesByWorkItem(workItems, files, false)

  assert.deepEqual(grouped.get('WI-1')?.map((file) => file.name), ['first.txt', 'second.txt'])
  assert.deepEqual(grouped.get('WI-2'), [])
  assert.deepEqual(grouped.get('WI-3'), [])
  assert.equal(grouped.has('UNKNOWN'), false)
  assert.equal(grouped.get('WI-1')?.[0], files[0])
})

test('deleted work item files are grouped separately', () => {
  const grouped = groupFilesByWorkItem(workItems, files, true)

  assert.deepEqual(grouped.get('WI-1'), [])
  assert.deepEqual(grouped.get('WI-2')?.map((file) => file.name), ['deleted.txt'])
  assert.equal(grouped.has('UNKNOWN'), false)
})

test('work items without files receive an empty bucket', () => {
  const grouped = groupFilesByWorkItem(workItems, [], false)

  assert.equal(grouped.size, 3)
  assert.deepEqual(grouped.get('WI-1'), [])
  assert.deepEqual(grouped.get('WI-2'), [])
  assert.deepEqual(grouped.get('WI-3'), [])
})
