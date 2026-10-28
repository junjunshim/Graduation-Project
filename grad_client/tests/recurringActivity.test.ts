import assert from 'node:assert/strict'
import test from 'node:test'
import { formatActivityMessage } from '../renderer/features/dashboard/model/activityFormatter.js'
import { getActivityLink } from '../renderer/features/dashboard/model/activityLink.js'
import {
  buildWorkItemIdSet,
  isLegacyScheduleCandidateWithIds,
  resolveActivityEntities,
  resolveActivityEntity,
} from '../renderer/features/dashboard/model/resolveActivityEntity.js'
import type { ActivityRecord } from '../renderer/features/workspace/model/types.js'

const activity: ActivityRecord = {
  id: 1, nodeId: 42, actorUserId: 'user-1', actorName: '홍길동',
  entityType: 'RECURRING_RULE', entityId: '17', targetName: '주간 회의',
  actionType: 'inserted', createdAt: '2026-09-14T00:00:00Z',
}

test('schedule lifecycle activity uses schedule wording', () => {
  for (const [actionType, action] of Object.entries({ inserted: '생성', created: '생성', updated: '수정', deleted: '삭제', restored: '복구' })) {
    assert.equal(formatActivityMessage({ ...activity, actionType }), `홍길동님이 일정 ‘주간 회의’를 ${action}했습니다.`)
  }
})

test('schedule activity links to its owning workspace and exact rule, including deleted activity', () => {
  for (const actionType of ['inserted', 'updated', 'deleted', 'restored']) {
    assert.equal(getActivityLink({ ...activity, actionType } as ActivityRecord), '/workspace?view=schedules&nodeId=42&ruleId=17')
  }
  assert.equal(getActivityLink({ ...activity, entityType: 'recurring_rule' }), '/workspace?view=schedules&nodeId=42&ruleId=17')
})

test('work items with the same ID still link to work item details', () => {
  assert.equal(getActivityLink({ ...activity, entityType: 'WORK_ITEM' }), '/work-items/17')
  assert.equal(getActivityLink({ ...activity, entityType: 'COMMENT', targetName: 'Comment on WI-7' }), '/work-items/WI-7')
  assert.equal(getActivityLink({ ...activity, entityType: 'ROLE' }), null)
})

test('legacy schedule lifecycle logs resolve both wording and route against real schedule records', () => {
  const rules = [{ ruleId: 17, ownerNodeId: 42 }]
  for (const actionType of ['inserted', 'updated', 'deleted', 'restored']) {
    const legacy = { ...activity, entityType: 'WORK_ITEM', actionType }
    const resolved = resolveActivityEntity(legacy, rules, [])
    assert.equal(resolved.entityType, 'RECURRING_RULE')
    assert.match(formatActivityMessage(resolved), /일정 ‘주간 회의’를/)
    assert.equal(getActivityLink(resolved), '/workspace?view=schedules&nodeId=42&ruleId=17')
    assert.equal(legacy.entityType, 'WORK_ITEM')
  }
})

test('numeric IDs alone, another workspace, and known work items do not become schedules', () => {
  const legacy = { ...activity, entityType: 'WORK_ITEM' }
  assert.equal(resolveActivityEntity(legacy, [], []), legacy)
  assert.equal(resolveActivityEntity(legacy, [{ ruleId: 17, ownerNodeId: 99 }], []), legacy)
  assert.equal(resolveActivityEntity(legacy, [{ ruleId: 17, ownerNodeId: 42 }], [{ workItemId: '17' }]), legacy)
  const fieldChange = { ...legacy, actionType: 'updated', fieldName: 'progress' }
  assert.equal(resolveActivityEntity(fieldChange, [{ ruleId: 17, ownerNodeId: 42 }], []), fieldChange)
})

test('work item ID lookup can be reused across activity checks', () => {
  const workItemIds = buildWorkItemIdSet([{ workItemId: '17' }])
  const knownWorkItem = { ...activity, entityType: 'WORK_ITEM' }
  const legacySchedule = { ...knownWorkItem, entityId: '18' }

  assert.equal(isLegacyScheduleCandidateWithIds(knownWorkItem, workItemIds), false)
  assert.equal(isLegacyScheduleCandidateWithIds(legacySchedule, workItemIds), true)
})

test('bulk activity resolution indexes rules once and preserves unchanged records', () => {
  const rules = [
    { ruleId: 17, ownerNodeId: 42 },
    { ruleId: 18, ownerNodeId: 42 },
  ]
  const legacySchedule = { ...activity, entityType: 'WORK_ITEM', entityId: '18' }
  const knownWorkItem = { ...activity, id: 2, entityType: 'WORK_ITEM', entityId: '19' }
  const unrelated = { ...activity, id: 3, entityType: 'WORK_ITEM', entityId: '999' }

  const resolved = resolveActivityEntities(
    [legacySchedule, knownWorkItem, unrelated],
    rules,
    [{ workItemId: '19' }],
  )

  assert.equal(resolved[0].entityType, 'RECURRING_RULE')
  assert.equal(resolved[1], knownWorkItem)
  assert.equal(resolved[2], unrelated)
})
