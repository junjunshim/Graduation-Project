import assert from 'node:assert/strict'
import test from 'node:test'
import {
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
