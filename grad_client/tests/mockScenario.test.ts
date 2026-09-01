import assert from 'node:assert/strict'
import test from 'node:test'
import { createMockScenarioSeed } from '../renderer/features/workspace/data/mockScenario.js'

test('default mock seed has unique identifiers and valid references', () => {
  const workspace = createMockScenarioSeed('default')
  const userIds = new Set(workspace.users.map((user) => user.userId))
  const emails = new Set(workspace.users.map((user) => user.email))
  const nodeIds = new Set(workspace.nodes.map((node) => node.id))
  const roleIds = new Set(workspace.roles.map((role) => role.id))
  const workItemIds = new Set(workspace.workItems.map((item) => item.workItemId))

  assert.equal(userIds.size, workspace.users.length)
  assert.equal(emails.size, workspace.users.length)
  assert.equal(nodeIds.size, workspace.nodes.length)
  assert.equal(roleIds.size, workspace.roles.length)
  assert.equal(workItemIds.size, workspace.workItems.length)

  workspace.roles.forEach((role) => {
    assert.ok(userIds.has(role.userId))
    assert.ok(nodeIds.has(role.nodeId))
  })

  workspace.nodes.forEach((node) => {
    assert.equal(node.path.at(-1), node.id)
    if (node.parentNodeId) assert.ok(nodeIds.has(node.parentNodeId))
  })

  workspace.workItems.forEach((item) => {
    assert.ok(userIds.has(item.ownerUserId))
    assert.ok(nodeIds.has(item.ownerNodeId))
    assert.ok(item.priority >= 1 && item.priority <= 5)
    assert.ok(item.weight >= 0)
    assert.ok(item.progress >= 0 && item.progress <= 100)
    if (item.parentWorkItemId) assert.ok(workItemIds.has(item.parentWorkItemId))
    if (item.startDate && item.dueDate) assert.ok(item.startDate <= item.dueDate)
  })
})

test('empty mock scenario supports authenticated empty-state testing', () => {
  const workspace = createMockScenarioSeed('empty')

  assert.equal(workspace.users.length, 1)
  assert.equal(workspace.nodes.length, 0)
  assert.equal(workspace.roles.length, 0)
  assert.equal(workspace.workItems.length, 0)
  assert.equal(workspace.users[0]?.personalNodeId, undefined)
})

test('boundary mock scenario covers min/max values and missing optional fields', () => {
  const workspace = createMockScenarioSeed('boundary')
  const minimum = workspace.workItems.find((item) => item.workItemId === 'WI-BOUNDARY-0')
  const maximum = workspace.workItems.find((item) => item.workItemId === 'WI-BOUNDARY-100')

  assert.equal(minimum?.priority, 1)
  assert.equal(minimum?.weight, 0)
  assert.equal(minimum?.progress, 0)
  assert.equal(minimum?.startDate, undefined)
  assert.equal(maximum?.priority, 5)
  assert.equal(maximum?.progress, 100)
  assert.equal(maximum?.startDate, maximum?.dueDate)
})

test('error mock scenario deliberately exercises the frontend error fallback', () => {
  assert.throws(
    () => createMockScenarioSeed('error'),
    /의도적으로 발생시킨 목 데이터 오류 시나리오/,
  )
})
