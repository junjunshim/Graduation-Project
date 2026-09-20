import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getServerAccessToken,
  getServerRefreshToken,
  getServerSessionEmail,
} from '../renderer/features/workspace/data/server/apiClient.js'
import { getServerContextSnapshot } from '../renderer/features/workspace/data/server/contextCache.js'
import {
  fetchRoleRemovalPreviewOnServer,
  isWorkspaceStructureNotification,
  removeRoleOnServer,
  signInServerUser,
} from '../renderer/features/workspace/data/server/serverWorkspace.js'
import { readWorkspaceDb } from '../renderer/features/workspace/data/localStore.js'

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
        role_id: 2,
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

  const workspace = readWorkspaceDb()
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

    if (calls.length === 2) {
      assert.match(String(input), /\/users\?target_email=user%40example\.com$/)
      assert.equal(init?.method, 'GET')
      assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer access-token')

      return jsonResponse({ status: 'success', data: [] })
    }

    assert.equal(calls.length, 3)
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
    assert.equal(calls.length, 3)

    const workspace = readWorkspaceDb()
    assert.equal(workspace.nodes.length, 1)
    assert.equal(workspace.nodes[0]?.id, 4)
    assert.deepEqual(workspace.nodes[0]?.path, [4])
    assert.equal(workspace.roles[0]?.roleName, 'ADMIN')
    assert.equal(workspace.workItems[0]?.workItemId, 'WI-1101')
    assert.equal(workspace.workItems[0]?.ownerNodeId, 4)
    assert.equal(workspace.workItems[0]?.ownerUserId, 'U-12')
    assert.equal(workspace.workItems[0]?.status, 'in-progress')
    assert.equal(workspace.workItems[0]?.progress, 40)

    // 권한/멘션/활동/파일 같은 부가 컨텍스트는 워크스페이스 캐시에 그대로 보존된다.
    assert.equal(workspace.authorities?.length, 1)
    assert.equal(workspace.authorities?.[0]?.nodeId, 4)
    assert.equal(workspace.authorities?.[0]?.authority, '011111111111111111111111')
    assert.equal(workspace.mentions?.length, 1)
    assert.equal(workspace.mentions?.[0]?.workItemId, 'WI-1101')
    assert.equal(workspace.mentions?.[0]?.isRead, false)
    assert.equal(workspace.activities?.length, 1)
    assert.equal(workspace.activities?.[0]?.actionType, 'updated')
    assert.equal(workspace.activities?.[0]?.newValue, 'in_progress')
    assert.equal(workspace.files?.length, 1)
    assert.equal(workspace.files?.[0]?.originalFileName, 'architecture_diagram.png')
    assert.equal(workspace.files?.[0]?.fileSize, 2_048_576)
    assert.equal(workspace.files?.[0]?.mimeType, 'image/png')
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

    if (requestCount === 2) {
      assert.match(String(input), /\/users\?target_email=/)
      return jsonResponse({ status: 'success', data: [] })
    }

    assert.equal(requestCount, 3)
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
    assert.equal(requestCount, 3)
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

test('워크스페이스 구조 변경 알림(생성/수정/복구)만 노드 트리를 즉시 다시 그린다', () => {
  assert.equal(isWorkspaceStructureNotification({ entity_type: 'NODE', action: 'inserted' }), true)
  assert.equal(isWorkspaceStructureNotification({ entity_type: 'NODE', action: 'created' }), true)
  assert.equal(isWorkspaceStructureNotification({ entity_type: 'NODE', action: 'updated' }), true)
  assert.equal(isWorkspaceStructureNotification({ entity_type: 'NODE', action: 'restored' }), true)
  assert.equal(isWorkspaceStructureNotification({ entity_type: 'node', action: 'INSERTED' }), true)

  // 삭제는 로컬 캐시 연쇄 반영으로 처리하므로 이 경로가 아니다.
  assert.equal(isWorkspaceStructureNotification({ entity_type: 'NODE', action: 'deleted' }), false)
  // 워크스페이스가 아닌 다른 엔터티의 변경은 트리와 무관하다.
  assert.equal(isWorkspaceStructureNotification({ entity_type: 'WORK_ITEM', action: 'created' }), false)
  assert.equal(isWorkspaceStructureNotification({ entity_type: 'ROLE', action: 'inserted' }), false)
  assert.equal(isWorkspaceStructureNotification({}), false)
})


/* ------------------------------------------------------------------ */
/* 역할 회수 (remove_role / removal-preview)                            */
/* ------------------------------------------------------------------ */

type CapturedCall = {
  pathname: string
  search: string
  method: string
  body: Record<string, unknown> | undefined
}

function captureCall(
  calls: CapturedCall[],
  input: Parameters<typeof fetch>[0],
  init: Parameters<typeof fetch>[1],
) {
  const url = new URL(String(input instanceof Request ? input.url : input))
  const rawBody = init?.body
  calls.push({
    pathname: url.pathname,
    search: url.search,
    method: String(init?.method ?? 'GET').toUpperCase(),
    body: typeof rawBody === 'string' ? (JSON.parse(rawBody) as Record<string, unknown>) : undefined,
  })
}

const roleRemovalPreviewPayload = {
  type: 'ROLE_REMOVAL_PREVIEW',
  can_remove: true,
  blocked_reason: null,
  node_id: 4,
  target_user_id: 'U-12',
  target_user_name: '이영희',
  target_user_email: 'user@example.com',
  role_id: 7,
  role: 'MEMBER',
  is_top_role: false,
  work_items: [
    {
      work_item_id: 'WI-1101',
      title: '로그인 기능 구현',
      owner_node_id: 4,
      owner_node_name: 'Development',
      hidden: true,
      status: 'in_progress',
    },
  ],
  transfer_targets: [{ user_id: 'U-13', name: '박민수', email: 'park@example.com' }],
}

test('역할 회수 사전 확인은 이관 업무와 이관 대상 목록을 파싱한다', async () => {
  const restoreWindow = installWindow(createMemoryStorage())
  const originalFetch = globalThis.fetch
  const calls: CapturedCall[] = []

  globalThis.fetch = async (input, init) => {
    captureCall(calls, input, init)
    return jsonResponse({ status: 'success', data: [roleRemovalPreviewPayload] })
  }

  try {
    const result = await fetchRoleRemovalPreviewOnServer('User@Example.com', 4)

    assert.equal(result.status, 'success')
    if (result.status !== 'success') return

    assert.equal(result.preview.canRemove, true)
    assert.equal(result.preview.roleName, 'MEMBER')
    assert.equal(result.preview.targetUserName, '이영희')
    assert.equal(result.preview.workItems.length, 1)
    assert.equal(result.preview.workItems[0].workItemId, 'WI-1101')
    assert.equal(result.preview.workItems[0].isHidden, true)
    assert.deepEqual(result.preview.transferTargets, [
      { userId: 'U-13', name: '박민수', email: 'park@example.com' },
    ])

    assert.equal(calls.length, 1)
    assert.equal(calls[0].pathname, '/api/roles/removal-preview')
    // 이메일은 소문자로 정규화해 쿼리에 담는다.
    assert.equal(calls[0].search, '?email=user%40example.com&node_id=4')
  } finally {
    globalThis.fetch = originalFetch
    restoreWindow()
  }
})

test('역할 회수는 이관 대상이 있을 때만 new_owner_email 을 보낸다', async () => {
  const restoreWindow = installWindow(createMemoryStorage())
  const originalFetch = globalThis.fetch
  const calls: CapturedCall[] = []

  globalThis.fetch = async (input, init) => {
    captureCall(calls, input, init)

    if (calls[calls.length - 1].method === 'DELETE') {
      return jsonResponse({
        status: 'success',
        data: [
          {
            type: 'ROLE',
            action: 'removed',
            transferred_work_item_count: 2,
            cleared_schedule_count: 1,
            transfer_target_name: '박민수',
          },
        ],
      })
    }

    return jsonResponse(createDocumentedContextResponse())
  }

  try {
    const withoutTransfer = await removeRoleOnServer({ nodeId: 4, email: 'User@Example.com' })
    assert.equal(withoutTransfer.status, 'success')
    assert.deepEqual(calls[0].body, { email: 'user@example.com', node_id: 4 })

    const withTransfer = await removeRoleOnServer({
      nodeId: 4,
      email: 'User@Example.com',
      newOwnerEmail: 'Park@Example.com',
    })

    assert.equal(withTransfer.status, 'success')
    if (withTransfer.status !== 'success') return

    assert.equal(withTransfer.result.transferredWorkItemCount, 2)
    assert.equal(withTransfer.result.clearedScheduleCount, 1)
    assert.equal(withTransfer.result.transferTargetName, '박민수')
    const deleteCalls = calls.filter((call) => call.method === 'DELETE')
    assert.deepEqual(deleteCalls[deleteCalls.length - 1].body, {
      email: 'user@example.com',
      node_id: 4,
      new_owner_email: 'park@example.com',
    })

    // 성공했을 때만 노드 상세를 다시 조회한다. (DELETE 2회 + 노드 재조회 2회)
    assert.equal(calls.filter((call) => call.method === 'GET').length, 2)
    assert.equal(calls.filter((call) => call.pathname === '/api/org/nodes').length, 2)
  } finally {
    globalThis.fetch = originalFetch
    restoreWindow()
  }
})

test('역할 회수가 서버에서 실패하면 로컬 캐시를 갱신하지 않는다', async () => {
  const restoreWindow = installWindow(createMemoryStorage())
  const originalFetch = globalThis.fetch
  const calls: CapturedCall[] = []

  globalThis.fetch = async (input, init) => {
    captureCall(calls, input, init)
    return jsonResponse(
      { status: 'error', code: '400', message: '업무를 이관할 수 없습니다. 이관 대상과 권한을 확인해 주세요.' },
      400,
    )
  }

  try {
    const result = await removeRoleOnServer({ nodeId: 4, email: 'user@example.com' })

    assert.equal(result.status, 'error')
    if (result.status !== 'error') return
    assert.equal(result.message, '업무를 이관할 수 없습니다. 이관 대상과 권한을 확인해 주세요.')

    assert.equal(calls.length, 1)
    assert.equal(calls[0].method, 'DELETE')
    // 실패했으므로 재조회(노드 상세) 요청이 없어야 한다.
    assert.equal(calls.filter((call) => call.pathname === '/api/org/nodes').length, 0)
  } finally {
    globalThis.fetch = originalFetch
    restoreWindow()
  }
})