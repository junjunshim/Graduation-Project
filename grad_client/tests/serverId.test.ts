import assert from 'node:assert/strict'
import test from 'node:test'
import { createServerEntityId } from '../renderer/features/workspace/data/server/serverId.js'

test('server entity IDs use collision-resistant UUID values within the database length limit', () => {
  const userId = createServerEntityId('U')
  const workItemId = createServerEntityId('WI')

  assert.match(userId, /^U-[0-9a-f-]{36}$/)
  assert.match(workItemId, /^WI-[0-9a-f-]{36}$/)
  assert.notEqual(userId.slice(2), workItemId.slice(3))
  assert.ok(userId.length <= 50)
  assert.ok(workItemId.length <= 50)
})
