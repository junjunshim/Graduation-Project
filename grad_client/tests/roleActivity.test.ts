import assert from 'node:assert/strict'
import test from 'node:test'
import { formatActivityMessage } from '../renderer/features/dashboard/model/activityFormatter.js'
import type { ActivityRecord } from '../renderer/features/workspace/model/types.js'

const activity: ActivityRecord = {
  id: 1, nodeId: 42, actorUserId: 'admin-id', actorName: '삼성 계정 관리자',
  entityType: 'ROLE', entityId: '8', targetName: '김민수',
  actionType: 'inserted', fieldName: 'role', newValue: 'MEMBER',
  createdAt: '2026-09-14T00:00:00Z',
}
const users = new Map([['member-id', '김민수']])
const options = { resolveUserName: (id: string) => users.get(id) }

test('role assignment preserves the recorded name when it is not a user ID', () => {
  assert.equal(formatActivityMessage(activity, options), '삼성 계정 관리자님이 ‘김민수’님에게 ‘MEMBER’ 역할을 부여했습니다.')
})

test('legacy role targets containing user IDs still resolve to names', () => {
  assert.equal(formatActivityMessage({ ...activity, targetName: 'member-id' }, options), '삼성 계정 관리자님이 ‘김민수’님에게 ‘MEMBER’ 역할을 부여했습니다.')
})

test('role changes and revocations also preserve the recorded target name', () => {
  assert.equal(formatActivityMessage({ ...activity, actionType: 'updated', oldValue: 'MEMBER', newValue: 'LEADER' }, options), '삼성 계정 관리자님이 ‘김민수’님의 역할을 변경했습니다. (‘MEMBER’ → ‘LEADER’)')
  assert.equal(formatActivityMessage({ ...activity, actionType: 'deleted' }, options), '삼성 계정 관리자님이 ‘김민수’님의 ‘MEMBER’ 역할을 회수했습니다.')
})
