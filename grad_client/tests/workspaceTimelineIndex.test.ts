import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildChronologicalTimelineTree,
  buildTimelineMemberNameLookup,
  getTimelineRange,
  resolveTimelineMemberName,
} from '../renderer/features/workspace/model/workspaceTaskIndex.js'

test('timeline member names prefer role members over user records', () => {
  const lookup = buildTimelineMemberNameLookup(
    [{ userId: 'U-1', name: 'Member Name' }],
    [{ userId: 'U-1', name: 'User Name', email: 'user@example.com' }],
  )

  assert.equal(resolveTimelineMemberName(lookup, 'U-1'), 'Member Name')
})

test('timeline falls back to users by user id or email while keeping the first match', () => {
  const lookup = buildTimelineMemberNameLookup(
    [],
    [
      { userId: 'U-2', name: 'First Match', email: 'shared@example.com' },
      { userId: 'U-3', name: 'Duplicate Match', email: 'shared@example.com' },
    ],
  )

  assert.equal(resolveTimelineMemberName(lookup, 'U-2'), 'First Match')
  assert.equal(resolveTimelineMemberName(lookup, 'U-3'), 'Duplicate Match')
  assert.equal(resolveTimelineMemberName(lookup, 'shared@example.com'), 'First Match')
})

test('timeline role member lookup is keyed by user id only', () => {
  const lookup = buildTimelineMemberNameLookup([
    { userId: 'U-4', name: 'Role Member', email: 'role@example.com' },
  ])

  assert.equal(resolveTimelineMemberName(lookup, 'U-4'), 'Role Member')
  assert.equal(resolveTimelineMemberName(lookup, 'role@example.com'), '담당자 미정')
})

test('timeline keeps the first duplicate role member name', () => {
  const lookup = buildTimelineMemberNameLookup([
    { userId: 'U-5', name: 'First Member' },
    { userId: 'U-5', name: 'Duplicate Member' },
  ])

  assert.equal(resolveTimelineMemberName(lookup, 'U-5'), 'First Member')
})

test('timeline uses the unassigned label when no identity matches', () => {
  const lookup = buildTimelineMemberNameLookup([], [])

  assert.equal(resolveTimelineMemberName(lookup, 'missing-user'), '담당자 미정')
})

test('timeline range uses today when there are no scheduled entries', () => {
  const today = Date.UTC(2026, 9, 21)

  assert.deepEqual(getTimelineRange([], today), {
    start: Date.UTC(2026, 3, 1),
    end: Date.UTC(2027, 4, 1),
  })
})

test('timeline range expands around the earliest and latest entries in one pass', () => {
  const today = Date.UTC(2026, 9, 21)

  assert.deepEqual(
    getTimelineRange(
      [
        { start: Date.UTC(2025, 0, 15), endExclusive: Date.UTC(2025, 0, 20) },
        { start: Date.UTC(2027, 0, 2), endExclusive: Date.UTC(2027, 0, 5) },
      ],
      today,
    ),
    {
      start: Date.UTC(2024, 6, 1),
      end: Date.UTC(2027, 7, 1),
    },
  )
})

test('timeline tree orders sibling groups by the earliest start in their subtree', () => {
  const items = [
    { workItemId: 'root-late', title: 'Late root', displayId: 1 },
    { workItemId: 'root-early', title: 'Early root', displayId: 2 },
    {
      workItemId: 'child-early',
      title: 'Early child',
      displayId: 3,
      parentWorkItemId: 'root-late',
    },
  ]
  const startById = new Map([
    ['root-late', Date.UTC(2026, 0, 20)],
    ['root-early', Date.UTC(2026, 0, 10)],
    ['child-early', Date.UTC(2026, 0, 5)],
  ])

  const tree = buildChronologicalTimelineTree(items, startById)

  assert.deepEqual(
    tree.roots.map((item) => item.workItemId),
    ['root-late', 'root-early'],
  )
  assert.deepEqual(
    tree.children.get('root-late')?.map((item) => item.workItemId),
    ['child-early'],
  )
})

test('timeline tree keeps unscheduled siblings at the bottom and breaks ties by display id', () => {
  const items = [
    { workItemId: 'unscheduled', title: 'No date', displayId: 1 },
    { workItemId: 'second', title: 'Second', displayId: 3 },
    { workItemId: 'first', title: 'First', displayId: 2 },
  ]
  const startById = new Map([
    ['second', Date.UTC(2026, 0, 5)],
    ['first', Date.UTC(2026, 0, 5)],
  ])

  const tree = buildChronologicalTimelineTree(items, startById)

  assert.deepEqual(
    tree.orderedItems.map((item) => item.workItemId),
    ['first', 'second', 'unscheduled'],
  )
})

test('timeline tree keeps all items when parent references form a cycle', () => {
  const items = [
    { workItemId: 'a', title: 'A', parentWorkItemId: 'b' },
    { workItemId: 'b', title: 'B', parentWorkItemId: 'a' },
  ]
  const startById = new Map([
    ['a', Date.UTC(2026, 0, 5)],
    ['b', Date.UTC(2026, 0, 6)],
  ])

  const tree = buildChronologicalTimelineTree(items, startById)

  assert.deepEqual(tree.roots, [])
  assert.equal(tree.orderedItems.length, 2)
  assert.deepEqual(
    tree.children.get('a')?.map((item) => item.workItemId),
    ['b'],
  )
})
