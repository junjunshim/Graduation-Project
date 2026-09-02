import assert from 'node:assert/strict'
import test from 'node:test'
import { getServerLoginTokens } from '../renderer/features/workspace/data/server/apiTypes.js'

test('server login accepts and normalizes both tokens from a success response', () => {
  assert.deepEqual(
    getServerLoginTokens({
      status: 'success',
      access_token: '  access-token  ',
      refresh_token: '  refresh-token  ',
    }),
    {
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
    },
  )
})

test('server login rejects error responses and missing or blank tokens', () => {
  assert.equal(
    getServerLoginTokens({
      status: 'error',
      access_token: 'access-token',
      refresh_token: 'refresh-token',
    }),
    null,
  )
  assert.equal(
    getServerLoginTokens({ status: 'success', access_token: 'access-token' }),
    null,
  )
  assert.equal(
    getServerLoginTokens({ status: 'success', refresh_token: 'refresh-token' }),
    null,
  )
  assert.equal(
    getServerLoginTokens({
      status: 'success',
      access_token: '   ',
      refresh_token: 'refresh-token',
    }),
    null,
  )
  assert.equal(
    getServerLoginTokens({
      status: 'success',
      access_token: 'access-token',
      refresh_token: '   ',
    }),
    null,
  )
})
