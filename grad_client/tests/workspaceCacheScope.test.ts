import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeServerWorkspaceDb,
  readWorkspaceDb,
  writeServerWorkspaceDb,
} from '../renderer/features/workspace/data/localStore.js'
import { fetchNodeDetailOnServer, loadWorkspaceDirectoryScopeOnServer } from '../renderer/features/workspace/data/server/serverWorkspace.js'
import { getOrgSnapshot } from '../renderer/features/workspace/data/orgService.js'

const timestamp = '2026-10-21T00:00:00.000Z'

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

function createSeedDb(options: { secondWorkItemNodeId: number }) {
  const secondNodeId = options.secondWorkItemNodeId

  return {
    datasetId: 'scope-test',
    seedVersion: 1,
    users: [{ userId: 'u1', email: 'u1@example.com', name: 'U1', createdAt: timestamp }],
    nodes: [
      { id: 1, nodeType: 'TEAM', name: 'N1', path: [1], isDeleted: false, createdAt: timestamp },
      { id: 2, nodeType: 'TEAM', name: 'N2', path: [2], isDeleted: false, createdAt: timestamp },
    ],
    roles: [],
    workItems: [
      {
        workItemId: 'WI-1',
        ownerNodeId: 1,
        ownerUserId: 'u1',
        title: 'W1',
        description: '',
        status: 'todo',
        priority: 3,
        weight: 0,
        progress: 0,
        computedProgress: 0,
        isDeleted: false,
        createdAt: timestamp,
      },
      {
        workItemId: 'WI-2',
        ownerNodeId: secondNodeId,
        ownerUserId: 'u1',
        title: 'W2',
        description: '',
        status: 'todo',
        priority: 3,
        weight: 0,
        progress: 0,
        computedProgress: 0,
        isDeleted: false,
        createdAt: timestamp,
      },
    ],
    authorities: [],
    mentions: [
      { id: 1, commentId: 1, workItemId: 'WI-1', message: 'm1', isRead: false, createdAt: timestamp },
      { id: 2, commentId: 2, workItemId: 'WI-2', message: 'm2', isRead: false, createdAt: timestamp },
    ],
    activities: [
      {
        id: 1,
        nodeId: 1,
        actorUserId: 'u1',
        actorName: 'U1',
        entityType: 'WORK_ITEM',
        entityId: 'WI-1',
        targetName: 'W1',
        actionType: 'updated',
        createdAt: timestamp,
      },
      {
        id: 2,
        nodeId: 2,
        actorUserId: 'u1',
        actorName: 'U1',
        entityType: 'WORK_ITEM',
        entityId: 'WI-2',
        targetName: 'W2',
        actionType: 'updated',
        createdAt: timestamp,
      },
    ],
    files: [
      {
        id: 1,
        workItemId: 'WI-1',
        uploaderUserId: 'u1',
        uploaderName: 'U1',
        uploaderEmail: 'u1@example.com',
        originalFileName: 'f1.txt',
        fileSize: 1,
        isDeleted: false,
        createdAt: timestamp,
      },
      {
        id: 2,
        workItemId: 'WI-2',
        uploaderUserId: 'u1',
        uploaderName: 'U1',
        uploaderEmail: 'u1@example.com',
        originalFileName: 'f2.txt',
        fileSize: 1,
        isDeleted: false,
        createdAt: timestamp,
      },
    ],
  }
}

test('경량 스코프 응답에서 사라진 노드의 업무/파일/활동/멘션을 캐시에서 제거한다', async () => {
  const restoreWindow = installWindow(createMemoryStorage())
  const originalFetch = globalThis.fetch
  writeServerWorkspaceDb(normalizeServerWorkspaceDb(createSeedDb({ secondWorkItemNodeId: 2 })))

  globalThis.fetch = async (input) => {
    assert.equal(getRequestPath(input), '/api/context/scope')
    return jsonResponse({
      status: 'success',
      data: [
        {
          type: 'NODE',
          id: 1,
          node_type: 'TEAM',
          title: 'N1',
          path: [1],
          is_deleted: false,
          created_at: timestamp,
        },
      ],
    })
  }

  try {
    await loadWorkspaceDirectoryScopeOnServer('u1@example.com')
    const db = readWorkspaceDb()

    assert.deepEqual(db.nodes.map((node) => node.id), [1])
    assert.deepEqual(db.workItems.map((item) => item.workItemId), ['WI-1'])
    assert.deepEqual((db.files ?? []).map((file) => file.id), [1])
    assert.deepEqual((db.activities ?? []).map((activity) => activity.id), [1])
    assert.deepEqual((db.mentions ?? []).map((mention) => mention.id), [1])
  } finally {
    globalThis.fetch = originalFetch
    restoreWindow()
  }
})

test('노드 상세 응답에 없는 업무/파일/활동을 해당 노드 범위에서 제거한다', async () => {
  const restoreWindow = installWindow(createMemoryStorage())
  const originalFetch = globalThis.fetch
  writeServerWorkspaceDb(normalizeServerWorkspaceDb(createSeedDb({ secondWorkItemNodeId: 1 })))

  globalThis.fetch = async (input) => {
    assert.equal(getRequestPath(input), '/api/org/nodes')
    return jsonResponse({
      status: 'success',
      data: [
        {
          type: 'NODE',
          id: 1,
          node_type: 'TEAM',
          title: 'N1',
          path: [1],
          is_deleted: false,
          created_at: timestamp,
        },
        {
          type: 'WORK_ITEM',
          id: 'WI-1',
          owner_node_id: 1,
          owner_user_id: 'u1',
          title: 'W1',
          status: 'todo',
          priority: 3,
          is_deleted: false,
          created_at: timestamp,
        },
        {
          type: 'FILE',
          id: 1,
          work_item_id: 'WI-1',
          uploader_user_id: 'u1',
          original_file_name: 'f1.txt',
          file_size: 1,
          is_deleted: false,
          created_at: timestamp,
        },
      ],
    })
  }

  try {
    await fetchNodeDetailOnServer(1)
    const db = readWorkspaceDb()

    assert.deepEqual(db.workItems.map((item) => item.workItemId), ['WI-1'])
    assert.deepEqual((db.files ?? []).map((file) => file.id), [1])
    assert.deepEqual((db.activities ?? []).map((activity) => activity.id), [2])
    assert.deepEqual((db.mentions ?? []).map((mention) => mention.id), [1])
  } finally {
    globalThis.fetch = originalFetch
    restoreWindow()
  }
})

test('DB revision 이 바뀌면 파생 스냅샷을 즉시 폐기한다', () => {
  const restoreWindow = installWindow(createMemoryStorage())

  try {
    writeServerWorkspaceDb(normalizeServerWorkspaceDb(createSeedDb({ secondWorkItemNodeId: 1 })))
    const first = getOrgSnapshot()
    assert.equal(first.nodes.length, 2)

    const withoutSecondNode = normalizeServerWorkspaceDb(createSeedDb({ secondWorkItemNodeId: 1 }))
    withoutSecondNode.nodes = withoutSecondNode.nodes.filter((node) => node.id !== 2)
    withoutSecondNode.workItems = withoutSecondNode.workItems.filter((item) => item.ownerNodeId !== 2)
    writeServerWorkspaceDb(withoutSecondNode)

    const second = getOrgSnapshot()
    assert.notEqual(second, first)
    assert.deepEqual(second.nodes.map((node) => node.id), [1])
  } finally {
    restoreWindow()
  }
})

test('빈 경량 스코프 응답도 캐시된 노드 범위 전체를 비운다', async () => {
  const restoreWindow = installWindow(createMemoryStorage())
  const originalFetch = globalThis.fetch
  writeServerWorkspaceDb(normalizeServerWorkspaceDb(createSeedDb({ secondWorkItemNodeId: 2 })))

  globalThis.fetch = async (input) => {
    assert.equal(getRequestPath(input), '/api/context/scope')
    return jsonResponse({ status: 'success', data: [] })
  }

  try {
    await loadWorkspaceDirectoryScopeOnServer('u1@example.com')
    const db = readWorkspaceDb()

    assert.deepEqual(db.nodes, [])
    assert.deepEqual(db.workItems, [])
    assert.deepEqual(db.files ?? [], [])
    assert.deepEqual(db.activities ?? [], [])
    assert.deepEqual(db.mentions ?? [], [])
  } finally {
    globalThis.fetch = originalFetch
    restoreWindow()
  }
})

test('노드 상세의 빈 응답도 요청한 노드의 하위 데이터 전체를 비운다', async () => {
  const restoreWindow = installWindow(createMemoryStorage())
  const originalFetch = globalThis.fetch
  writeServerWorkspaceDb(normalizeServerWorkspaceDb(createSeedDb({ secondWorkItemNodeId: 2 })))

  globalThis.fetch = async (input) => {
    assert.equal(getRequestPath(input), '/api/org/nodes')
    return jsonResponse({ status: 'success', data: [] })
  }

  try {
    await fetchNodeDetailOnServer(1)
    const db = readWorkspaceDb()

    assert.deepEqual(db.nodes.map((node) => node.id), [1, 2])
    assert.deepEqual(db.workItems.map((item) => item.workItemId), ['WI-2'])
    assert.deepEqual((db.files ?? []).map((file) => file.id), [2])
    assert.deepEqual((db.activities ?? []).map((activity) => activity.id), [2])
    assert.deepEqual((db.mentions ?? []).map((mention) => mention.id), [2])
  } finally {
    globalThis.fetch = originalFetch
    restoreWindow()
  }
})
