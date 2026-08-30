import assert from 'node:assert/strict'
import test from 'node:test'
import { getServerLoginAccessToken } from '../renderer/features/workspace/data/server/apiTypes.js'

test('server login accepts an access-token-only success response', () => {
  assert.equal(
    getServerLoginAccessToken({
      status: 'success',
      access_token: 'access-token',
    }),
    'access-token',
  )
  assert.equal(
    getServerLoginAccessToken({ status: 'success', access_token: '  access-token  ' }),
    'access-token',
  )
})

test('server login rejects error responses and missing access tokens', () => {
  assert.equal(getServerLoginAccessToken({ status: 'error', access_token: 'access-token' }), null)
  assert.equal(getServerLoginAccessToken({ status: 'success' }), null)
  assert.equal(getServerLoginAccessToken({ status: 'success', access_token: '   ' }), null)
})
