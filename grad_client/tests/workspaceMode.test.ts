import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveWorkspaceRuntimeConfiguration } from '../renderer/features/workspace/data/server/workspaceMode.js'

test('mock mode is isolated from unused server URL and timeout settings', () => {
  const configuration = resolveWorkspaceRuntimeConfiguration({
    VITE_WORKSPACE_DATA_SOURCE: 'mock',
    VITE_WORKSPACE_API_BASE_URL: 'not-a-url',
    VITE_WORKSPACE_API_TIMEOUT_MS: '0',
  })

  assert.equal(configuration.dataSource, 'mock')
  assert.equal(configuration.configurationError, null)
})

test('server mode rejects invalid URL and timeout settings', () => {
  const invalidUrl = resolveWorkspaceRuntimeConfiguration({
    VITE_WORKSPACE_DATA_SOURCE: 'server',
    VITE_WORKSPACE_API_BASE_URL: 'not-a-url',
  })
  const invalidTimeout = resolveWorkspaceRuntimeConfiguration({
    VITE_WORKSPACE_DATA_SOURCE: 'server',
    VITE_WORKSPACE_API_BASE_URL: 'https://api.example.test/api/v1/',
    VITE_WORKSPACE_API_TIMEOUT_MS: '-1',
  })

  assert.match(invalidUrl.configurationError ?? '', /URL/)
  assert.match(invalidTimeout.configurationError ?? '', /0보다 큰 숫자/)
  assert.equal(invalidTimeout.apiBaseUrl, 'https://api.example.test/api/v1')
})
