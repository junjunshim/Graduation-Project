import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ApiClientError,
  apiRequest,
} from '../renderer/features/workspace/data/server/apiClient.js'

test('api client normalizes the base URL and serializes JSON bodies', async () => {
  const originalFetch = globalThis.fetch

  globalThis.fetch = async (input, init) => {
    assert.equal(input, 'http://localhost:8080/api/v1/users')
    assert.equal(init?.method, 'POST')
    assert.equal(init?.credentials, 'omit')
    assert.equal(new Headers(init?.headers).get('Content-Type'), 'application/json')
    assert.equal(init?.body, JSON.stringify({ email: 'test@example.com' }))
    return new Response(JSON.stringify({ status: 'success' }), { status: 200 })
  }

  try {
    const response = await apiRequest<{ status: string }>('/users', {
      method: 'POST',
      body: { email: 'test@example.com' },
      includeToken: false,
      timeoutMs: 100,
    })
    assert.equal(response.status, 'success')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('GET and 204 responses do not require a JSON body', async () => {
  const originalFetch = globalThis.fetch

  globalThis.fetch = async (_input, init) => {
    assert.equal(new Headers(init?.headers).has('Content-Type'), false)
    return new Response(null, { status: 204 })
  }

  try {
    assert.equal(await apiRequest<null>('/context/init', { includeToken: false }), null)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('HTTP, parse, network, and timeout failures retain distinct error kinds', async (context) => {
  const originalFetch = globalThis.fetch

  context.after(() => {
    globalThis.fetch = originalFetch
  })

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ status: 'error', code: '403', message: '권한이 없습니다.' }), {
      status: 403,
    })

  await assert.rejects(
    apiRequest('/roles', { includeToken: false, timeoutMs: 100 }),
    (error: unknown) =>
      error instanceof ApiClientError &&
      error.kind === 'http' &&
      error.status === 403 &&
      error.code === '403' &&
      error.message === '권한이 없습니다.',
  )

  globalThis.fetch = async () => new Response('<html>not json</html>', { status: 200 })
  await assert.rejects(
    apiRequest('/context/init', { includeToken: false, timeoutMs: 100 }),
    (error: unknown) => error instanceof ApiClientError && error.kind === 'parse',
  )

  globalThis.fetch = async () => {
    throw new TypeError('connection refused')
  }
  await assert.rejects(
    apiRequest('/context/init', { includeToken: false, timeoutMs: 100 }),
    (error: unknown) => error instanceof ApiClientError && error.kind === 'network',
  )

  globalThis.fetch = async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
        once: true,
      })
    })

  await assert.rejects(
    apiRequest('/context/init', { includeToken: false, timeoutMs: 5 }),
    (error: unknown) => error instanceof ApiClientError && error.kind === 'timeout',
  )
})

test('the request timeout remains active while the response body is being read', async (context) => {
  const originalFetch = globalThis.fetch

  context.after(() => {
    globalThis.fetch = originalFetch
  })

  globalThis.fetch = (async (_input, init) => {
    const signal = init?.signal

    return {
      ok: true,
      status: 200,
      text: () =>
        new Promise<string>((_resolve, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          )
        }),
    } as Response
  }) as typeof fetch

  await assert.rejects(
    apiRequest('/slow-body', { includeToken: false, timeoutMs: 10 }),
    (error: unknown) => error instanceof ApiClientError && error.kind === 'timeout',
  )
})

test('5xx response details are not exposed through the user-facing error message', async (context) => {
  const originalFetch = globalThis.fetch

  context.after(() => {
    globalThis.fetch = originalFetch
  })

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        status: 'error',
        message: 'SQLSTATE 23505: users_pkey internal detail',
      }),
      { status: 500 },
    )

  await assert.rejects(
    apiRequest('/users', { includeToken: false, timeoutMs: 100 }),
    (error: unknown) =>
      error instanceof ApiClientError &&
      error.kind === 'http' &&
      error.status === 500 &&
      !error.message.includes('SQLSTATE'),
  )
})
