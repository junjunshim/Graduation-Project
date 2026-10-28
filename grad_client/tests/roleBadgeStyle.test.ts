import assert from 'node:assert/strict'
import test from 'node:test'
import { getRoleBadgeStyle } from '../renderer/features/workspace/model/labels.js'

test('같은 역할은 대소문자와 공백을 정리한 캐시 스타일을 재사용한다', () => {
  const first = getRoleBadgeStyle('Developer')
  const second = getRoleBadgeStyle('  developer  ')

  assert.equal(first, second)
})

test('ADMIN과 최상위 역할은 동일한 관리자 스타일을 사용한다', () => {
  const admin = getRoleBadgeStyle('admin')
  const topRole = getRoleBadgeStyle('Member', true)

  assert.equal(admin, topRole)
  assert.equal(admin.backgroundColor, 'var(--axis-status-danger-soft, #FBECE9)')
})

test('서로 다른 역할은 서로 다른 스타일 객체를 사용한다', () => {
  const developer = getRoleBadgeStyle('Developer')
  const designer = getRoleBadgeStyle('Designer')

  assert.notEqual(developer, designer)
})
