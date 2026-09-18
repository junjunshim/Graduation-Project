import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveWorkspaceRuntimeConfiguration } from '../renderer/features/workspace/data/server/workspaceMode.js'

const DEFAULT_API_BASE_URL = 'http://localhost:8080/api'
const DEFAULT_API_TIMEOUT_MS = 10_000

test('missing environment values fall back to the local server defaults', () => {
  const configuration = resolveWorkspaceRuntimeConfiguration({})

  assert.equal(configuration.apiBaseUrl, DEFAULT_API_BASE_URL)
  assert.equal(configuration.apiTimeoutMs, DEFAULT_API_TIMEOUT_MS)
  assert.equal(configuration.configurationError, null)
})

test('an invalid API URL is reported and replaced by the default base URL', () => {
  const configuration = resolveWorkspaceRuntimeConfiguration({
    VITE_WORKSPACE_API_BASE_URL: 'not-a-url',
  })

  assert.match(configuration.configurationError ?? '', /URL/)
  assert.equal(configuration.apiBaseUrl, DEFAULT_API_BASE_URL)
})

test('a non http(s) API URL is rejected', () => {
  const configuration = resolveWorkspaceRuntimeConfiguration({
    VITE_WORKSPACE_API_BASE_URL: 'ws://localhost:8080/api',
  })

  assert.match(configuration.configurationError ?? '', /http/)
  assert.equal(configuration.apiBaseUrl, DEFAULT_API_BASE_URL)
})

test('an invalid timeout is reported and replaced by the default timeout', () => {
  const configuration = resolveWorkspaceRuntimeConfiguration({
    VITE_WORKSPACE_API_BASE_URL: 'https://api.example.test/api/v1/',
    VITE_WORKSPACE_API_TIMEOUT_MS: '-1',
  })

  assert.match(configuration.configurationError ?? '', /0보다 큰 숫자/)
  assert.equal(configuration.apiTimeoutMs, DEFAULT_API_TIMEOUT_MS)
  assert.equal(configuration.apiBaseUrl, 'https://api.example.test/api/v1')
})

test('valid settings are trimmed of trailing slashes', () => {
  const configuration = resolveWorkspaceRuntimeConfiguration({
    VITE_WORKSPACE_API_BASE_URL: '  https://api.example.test/api/  ',
    VITE_WORKSPACE_API_TIMEOUT_MS: '2500',
  })

  assert.equal(configuration.configurationError, null)
  assert.equal(configuration.apiBaseUrl, 'https://api.example.test/api')
  assert.equal(configuration.apiTimeoutMs, 2500)
})
