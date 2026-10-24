import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearQueryCacheForTests,
  invalidateQueryCache,
  queryWithCache,
} from '../renderer/features/workspace/data/queryCache.js'
import {
  clearServerSession,
  setServerSession,
} from '../renderer/features/workspace/data/server/apiClient.js'

function createMemoryStorage(): Storage {
  const values = new Map<string, string>()

  return {
    get length() {
      return values.size
    },
    clear() {
      values.clear()
    },
    getItem(key) {
      return values.get(key) ?? null
    },
    key(index) {
      return Array.from(values.keys())[index] ?? null
    },
    removeItem(key) {
      values.delete(key)
    },
    setItem(key, value) {
      values.set(key, value)
    },
  }
}

test('query cache reuses a fresh value without calling the fetcher again', async () => {
  clearQueryCacheForTests()
  let calls = 0

  const first = await queryWithCache('test:fresh', async () => {
    calls += 1
    return { value: calls }
  }, { ttlMs: 60_000 })

  const second = await queryWithCache('test:fresh', async () => {
    calls += 1
    return { value: calls }
  }, { ttlMs: 60_000 })

  assert.equal(calls, 1)
  assert.equal(second, first)
})

test('query cache fetches again after the ttl expires', async () => {
  clearQueryCacheForTests()
  let calls = 0
  const fetcher = async () => {
    calls += 1
    return calls
  }

  assert.equal(await queryWithCache('test:stale', fetcher, { ttlMs: 0 }), 1)
  assert.equal(await queryWithCache('test:stale', fetcher, { ttlMs: 0 }), 2)
  assert.equal(calls, 2)
})

test('query cache shares an in-flight request', async () => {
  clearQueryCacheForTests()
  let calls = 0
  let resolveRequest!: (value: number) => void

  const first = queryWithCache('test:inflight', () => {
    calls += 1
    return new Promise<number>((resolve) => {
      resolveRequest = resolve
    })
  }, { ttlMs: 60_000 })

  const second = queryWithCache('test:inflight', async () => {
    calls += 1
    return 99
  }, { ttlMs: 60_000 })

  assert.equal(calls, 1)
  resolveRequest(7)
  assert.equal(await first, 7)
  assert.equal(await second, 7)
})

test('query cache invalidation only removes matching prefixes', async () => {
  clearQueryCacheForTests()
  let githubCalls = 0
  let recurringCalls = 0

  await queryWithCache('github:repos:1', async () => {
    githubCalls += 1
    return githubCalls
  }, { ttlMs: 60_000 })
  await queryWithCache('recurring:1:all', async () => {
    recurringCalls += 1
    return recurringCalls
  }, { ttlMs: 60_000 })

  invalidateQueryCache('github:')

  assert.equal(await queryWithCache('github:repos:1', async () => {
    githubCalls += 1
    return githubCalls
  }, { ttlMs: 60_000 }), 2)
  assert.equal(await queryWithCache('recurring:1:all', async () => {
    recurringCalls += 1
    return recurringCalls
  }, { ttlMs: 60_000 }), 1)
})

test('query cache force refresh bypasses a fresh entry', async () => {
  clearQueryCacheForTests()
  let calls = 0
  const fetcher = async () => {
    calls += 1
    return calls
  }

  assert.equal(await queryWithCache('test:force', fetcher, { ttlMs: 60_000 }), 1)
  assert.equal(await queryWithCache('test:force', fetcher, {
    ttlMs: 60_000,
    forceRefresh: true,
  }), 2)
})

test('query cache does not cache a failed request', async () => {
  clearQueryCacheForTests()
  let calls = 0
  const fetcher = async () => {
    calls += 1
    if (calls === 1) {
      throw new Error('temporary failure')
    }
    return 'ok'
  }

  await assert.rejects(queryWithCache('test:failure', fetcher, { ttlMs: 60_000 }), /temporary failure/)
  assert.equal(await queryWithCache('test:failure', fetcher, { ttlMs: 60_000 }), 'ok')
  assert.equal(calls, 2)
})

test('an invalidated in-flight response cannot overwrite newer cache data', async () => {
  clearQueryCacheForTests()
  let resolveOldRequest!: (value: string) => void

  const oldRequest = queryWithCache('test:invalidation-race', () => {
    return new Promise<string>((resolve) => {
      resolveOldRequest = resolve
    })
  }, { ttlMs: 60_000 })

  invalidateQueryCache('test:invalidation-race')

  const newRequest = queryWithCache('test:invalidation-race', async () => 'new', {
    ttlMs: 60_000,
  })

  resolveOldRequest('old')

  assert.equal(await oldRequest, 'old')
  assert.equal(await newRequest, 'new')
  assert.equal(await queryWithCache('test:invalidation-race', async () => 'unexpected', {
    ttlMs: 60_000,
  }), 'new')
})

test('query cache isolates entries by the current server session', async () => {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const localStorage = createMemoryStorage()
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage },
  })

  clearQueryCacheForTests()
  try {
    setServerSession({
      accessToken: 'access-a',
      refreshToken: 'refresh-a',
      email: 'user-a@example.com',
    })

    let calls = 0
    const fetcher = async () => {
      calls += 1
      return `value-${calls}`
    }

    assert.equal(await queryWithCache('test:session', fetcher, { ttlMs: 60_000 }), 'value-1')
    assert.equal(await queryWithCache('test:session', fetcher, { ttlMs: 60_000 }), 'value-1')

    setServerSession({
      accessToken: 'access-b',
      refreshToken: 'refresh-b',
      email: 'user-b@example.com',
    })

    assert.equal(await queryWithCache('test:session', fetcher, { ttlMs: 60_000 }), 'value-2')
    assert.equal(calls, 2)
  } finally {
    clearServerSession()
    clearQueryCacheForTests()
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', originalWindowDescriptor)
    } else {
      Reflect.deleteProperty(globalThis, 'window')
    }
  }
})
