import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getServerAccessToken,
  getServerRefreshToken,
  getServerSessionEmail,
} from '../renderer/features/workspace/data/server/apiClient.js'
import { getServerContextSnapshot } from '../renderer/features/workspace/data/server/contextCache.js'
import { signInServerUser } from '../renderer/features/workspace/data/server/serverWorkspace.js'
import { readServerWorkspaceDb } from '../renderer/features/workspace/data/localStore.js'

type MemoryStorageOptions = {
  failSetKey?: string
}

type FetchCall = {
  input: Parameters<typeof fetch>[0]
  init: Parameters<typeof fetch>[1]
}

function createMemoryStorage(options: MemoryStorageOptions = {}): Storage {
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
      if (key === options.failSetKey) {
        throw new Error(`storage write failed for ${key}`)
      }

      values.set(key, value)
    },
  }
}

function installWindow(localStorage: Storage) {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage,
      dispatchEvent: () => true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  })

  return () => {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', originalWindowDescriptor)
    } else {
      Reflect.deleteProperty(globalThis, 'window')
    }
  }
}

function getRequestPath(input: Parameters<typeof fetch>[0]) {
  if (input instanceof Request) {
    return new URL(input.url).pathname
  }

  return new URL(String(input)).pathname
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function createDocumentedContextResponse() {
  const timestamp = '2026-03-19 12:29:24.745634+00'

  return {
    status: 'success',
    server_time: timestamp,
    data: [
      {
        type: 'NODE',
        id: 4,
        node_type: 'DEPARTMENT',
        parent_id: null,
        title: 'Development',
        path: [4],
        is_deleted: false,
        updated_at: timestamp,
      },
      {
        type: 'WORK_ITEM',
        id: 'WI-1101',
        parent_id: null,
        owner_node_id: 4,
        owner_user_id: 'U-12',
        title: 'Context initialization',
        description: 'Parse the documented initial context.',
        category: 'FEATURE',
        status: 'in_progress',
        priority: 3,
        hidden: false,
        weight: 1,
        progress: 40,
        comment_count: 2,
        is_deleted: false,
        start_date: '2026-03-01',
        due_date: '2026-03-31',
        updated_at: timestamp,
      },
      {
        type: 'ROLE',
        id: 20,
        node_id: 4,
        email: 'user@example.com',
        role: 'ADMIN',
        updated_at: timestamp,
      },
      {
        type: 'AUTHORITY',
        id: 2,
        node_id: 4,
        role: 'ADMIN',
        authority: '011111111111111111111111',
        updated_at: timestamp,
      },
      {
        type: 'MENTION',
        id: 12,
        comment_id: 101,
        work_item_id: 'WI-1101',
        message: 'You were mentioned.',
        is_read: false,
        created_at: timestamp,
        updated_at: timestamp,
      },
      {
        type: 'ACTIVITY',
        id: 501,
        node_id: 4,
        actor_user_id: 'U-12',
        actor_name: 'User',
        entity_type: 'WORK_ITEM',
        entity_id: 'WI-1101',
        target_name: 'Context initialization',
        action_type: 'updated',
        field_name: 'status',
        old_value: 'todo',
        new_value: 'in_progress',
        created_at: timestamp,
      },
      {
        type: 'FILE',
        id: 77,
        work_item_id: 'WI-1101',
        uploader_user_id: 'U-12',
        uploader_name: 'User',
        uploader_email: 'user@example.com',
        original_file_name: 'architecture_diagram.png',
        file_size: 2_048_576,
        mime_type: 'image/png',
        is_deleted: false,
        created_at: timestamp,
        updated_at: timestamp,
      },
    ],
  }
}

function assertEmptyServerState() {
  assert.equal(getServerAccessToken(), null)
  assert.equal(getServerRefreshToken(), null)
  assert.equal(getServerSessionEmail(), null)
  assert.equal(getServerContextSnapshot(), null)

  const workspace = readServerWorkspaceDb()
  assert.equal(workspace.nodes.length, 0)
  assert.equal(workspace.roles.length, 0)
  assert.equal(workspace.workItems.length, 0)
}

test('server login stores both tokens before loading and preserving the documented initial context', async () => {
  const restoreWindow = installWindow(createMemoryStorage())
  const originalFetch = globalThis.fetch
  const calls: FetchCall[] = []

  globalThis.fetch = async (input, init) => {
    calls.push({ input, init })
    const path = getRequestPath(input)

    if (calls.length === 1) {
      assert.match(path, /\/users\/login$/)
      assert.equal(init?.method, 'POST')
      assert.equal(new Headers(init?.headers).get('Authorization'), null)
      assert.deepEqual(JSON.parse(String(init?.body)), {
        email: 'user@example.com',
        password: 'secret',
      })

      return jsonResponse({
        status: 'success',
        access_token: 'access-token',
        refresh_token: 'refresh-token',
      })
    }

    assert.equal(calls.length, 2)
    assert.match(path, /\/context\/init$/)
    assert.equal(init?.method, 'GET')
    assert.equal(getServerAccessToken(), 'access-token')
    assert.equal(getServerRefreshToken(), 'refresh-token')
    assert.equal(getServerSessionEmail(), 'user@example.com')
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer access-token')
    assert.equal(init?.body, undefined)

    return jsonResponse(createDocumentedContextResponse())
  }

  try {
    const response = await signInServerUser({
      email: '  USER@example.com ',
      password: 'secret',
    })

    assert.equal(response.status, 'success')
    assert.equal(calls.length, 2)

    const workspace = readServerWorkspaceDb()
    assert.equal(workspace.nodes.length, 1)
    assert.equal(workspace.nodes[0]?.id, 4)
    assert.deepEqual(workspace.nodes[0]?.path, [4])
    assert.equal(workspace.roles[0]?.roleName, 'ADMIN')
    assert.equal(workspace.workItems[0]?.workItemId, 'WI-1101')
    assert.equal(workspace.workItems[0]?.ownerNodeId, 4)
    assert.equal(workspace.workItems[0]?.ownerUserId, 'U-12')
    assert.equal(workspace.workItems[0]?.status, 'in-progress')
    assert.equal(workspace.workItems[0]?.progress, 40)

    const snapshot = getServerContextSnapshot()
    assert.ok(snapshot)
    assert.equal(snapshot.serverTime, '2026-03-19 12:29:24.745634+00')
    assert.equal(snapshot.authorities.length, 1)
    assert.equal(snapshot.authorities[0]?.nodeId, 4)
    assert.equal(snapshot.authorities[0]?.authority, '011111111111111111111111')
    assert.equal(snapshot.mentions.length, 1)
    assert.equal(snapshot.mentions[0]?.workItemId, 'WI-1101')
    assert.equal(snapshot.mentions[0]?.isRead, false)
    assert.equal(snapshot.activities.length, 1)
    assert.equal(snapshot.activities[0]?.actionType, 'updated')
    assert.equal(snapshot.activities[0]?.newValue, 'in_progress')
    assert.equal(snapshot.files.length, 1)
    assert.equal(snapshot.files[0]?.originalFileName, 'architecture_diagram.png')
    assert.equal(snapshot.files[0]?.fileSize, 2_048_576)
    assert.equal(snapshot.files[0]?.mimeType, 'image/png')
  } finally {
    globalThis.fetch = originalFetch
    restoreWindow()
  }
})

test('server login rolls back tokens and all context caches when initial context parsing fails', async () => {
  const restoreWindow = installWindow(createMemoryStorage())
  const originalFetch = globalThis.fetch
  let requestCount = 0

  globalThis.fetch = async (input, init) => {
    requestCount += 1

    if (requestCount === 1) {
      assert.match(getRequestPath(input), /\/users\/login$/)
      return jsonResponse({
        status: 'success',
        access_token: 'access-token',
        refresh_token: 'refresh-token',
      })
    }

    assert.equal(requestCount, 2)
    assert.match(getRequestPath(input), /\/context\/init$/)
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer access-token')
    assert.equal(getServerRefreshToken(), 'refresh-token')

    return jsonResponse({
      status: 'success',
      server_time: '2026-03-19 12:29:24.745634+00',
      data: { invalid: 'context data must be an array' },
    })
  }

  try {
    const response = await signInServerUser({
      email: 'user@example.com',
      password: 'secret',
    })

    assert.equal(response.status, 'error')
    assert.equal(requestCount, 2)
    assertEmptyServerState()
  } finally {
    globalThis.fetch = originalFetch
    restoreWindow()
  }
})

test('server login does not initialize context and removes partial tokens when refresh-token storage fails', async () => {
  const restoreWindow = installWindow(
    createMemoryStorage({ failSetKey: 'grad-client-server-refresh-token' }),
  )
  const originalFetch = globalThis.fetch
  let loginRequestCount = 0
  let contextRequestCount = 0

  globalThis.fetch = async (input) => {
    const path = getRequestPath(input)

    if (/\/users\/login$/.test(path)) {
      loginRequestCount += 1
      return jsonResponse({
        status: 'success',
        access_token: 'partial-access-token',
        refresh_token: 'refresh-token-that-cannot-be-stored',
      })
    }

    contextRequestCount += 1
    return jsonResponse(createDocumentedContextResponse())
  }

  try {
    const response = await signInServerUser({
      email: 'user@example.com',
      password: 'secret',
    })

    assert.equal(response.status, 'error')
    assert.equal(loginRequestCount, 1)
    assert.equal(contextRequestCount, 0)
    assertEmptyServerState()
  } finally {
    globalThis.fetch = originalFetch
    restoreWindow()
  }
})
