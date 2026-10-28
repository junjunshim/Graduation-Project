export type CachedFileItem = {
  fileId: number
  fileName: string
  content: string
  lastModified?: string
  cachedAt: number
}

export const FILE_CONTENT_MEMORY_MAX_ITEMS = 32
const FILE_CONTENT_MEMORY_MAX_BYTES = 16 * 1024 * 1024
const DB_NAME = 'axis-flow-file-content-cache'
const DB_VERSION = 1
const STORE_NAME = 'fileContents'

const memoryCache = new Map<number, CachedFileItem>()
let memoryBytes = 0
let dbPromise: Promise<IDBDatabase | null> | null = null

function estimateItemBytes(item: CachedFileItem) {
  return (item.content.length + item.fileName.length + (item.lastModified?.length ?? 0)) * 2 + 64
}

function forgetMemoryFile(fileId: number) {
  const existing = memoryCache.get(fileId)
  if (!existing) {
    return
  }

  memoryBytes -= estimateItemBytes(existing)
  memoryCache.delete(fileId)
}

function evictMemoryFiles() {
  while (memoryCache.size > FILE_CONTENT_MEMORY_MAX_ITEMS || memoryBytes > FILE_CONTENT_MEMORY_MAX_BYTES) {
    const oldest = memoryCache.keys().next()
    if (oldest.done) {
      break
    }
    forgetMemoryFile(oldest.value)
  }
}

function rememberMemoryFile(item: CachedFileItem) {
  forgetMemoryFile(item.fileId)
  memoryCache.set(item.fileId, item)
  memoryBytes += estimateItemBytes(item)
  evictMemoryFiles()
}

function recallMemoryFile(fileId: number) {
  const item = memoryCache.get(fileId)
  if (!item) {
    return null
  }

  // Map insertion order doubles as the LRU order.
  memoryCache.delete(fileId)
  memoryCache.set(fileId, item)
  return item
}

function isCachedFileItem(value: unknown): value is CachedFileItem {
  if (!value || typeof value !== 'object') {
    return false
  }

  const item = value as Partial<CachedFileItem>
  return (
    typeof item.fileId === 'number' &&
    Number.isFinite(item.fileId) &&
    typeof item.fileName === 'string' &&
    typeof item.content === 'string' &&
    typeof item.cachedAt === 'number' &&
    Number.isFinite(item.cachedAt) &&
    (item.lastModified === undefined || typeof item.lastModified === 'string')
  )
}

function openFileCacheDb(): Promise<IDBDatabase | null> {
  if (dbPromise) {
    return dbPromise
  }

  if (typeof indexedDB === 'undefined') {
    dbPromise = Promise.resolve(null)
    return dbPromise
  }

  dbPromise = new Promise((resolve) => {
    let request: IDBOpenDBRequest

    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      resolve(null)
      return
    }

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'fileId' })
        store.createIndex('cachedAt', 'cachedAt')
      }
    }

    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }

    request.onerror = () => {
      dbPromise = null
      resolve(null)
    }

    request.onblocked = () => {
      dbPromise = null
      resolve(null)
    }
  })

  return dbPromise
}

async function readPersistedFile(fileId: number): Promise<CachedFileItem | null> {
  const db = await openFileCacheDb()
  if (!db) {
    return null
  }

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, 'readonly')
      const request = transaction.objectStore(STORE_NAME).get(fileId)
      request.onsuccess = () => {
        resolve(isCachedFileItem(request.result) ? request.result : null)
      }
      request.onerror = () => resolve(null)
    } catch {
      dbPromise = null
      resolve(null)
    }
  })
}

async function writePersistedFile(item: CachedFileItem): Promise<void> {
  const db = await openFileCacheDb()
  if (!db) {
    return
  }

  await new Promise<void>((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put(item)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => resolve()
      transaction.onabort = () => resolve()
    } catch {
      dbPromise = null
      resolve()
    }
  })
}

async function deletePersistedFile(fileId: number): Promise<void> {
  const db = await openFileCacheDb()
  if (!db) {
    return
  }

  await new Promise<void>((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).delete(fileId)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => resolve()
      transaction.onabort = () => resolve()
    } catch {
      dbPromise = null
      resolve()
    }
  })
}

export async function getCachedFileContent(fileId: number): Promise<CachedFileItem | null> {
  const memoryItem = recallMemoryFile(fileId)
  if (memoryItem) {
    return memoryItem
  }

  const persistedItem = await readPersistedFile(fileId)
  if (persistedItem) {
    rememberMemoryFile(persistedItem)
  }
  return persistedItem
}

export async function setCachedFileContent(item: CachedFileItem): Promise<void> {
  rememberMemoryFile(item)
  await writePersistedFile(item)
}

export async function deleteCachedFileContent(fileId: number): Promise<void> {
  forgetMemoryFile(fileId)
  await deletePersistedFile(fileId)
}

export async function clearCachedFileContents(): Promise<void> {
  memoryCache.clear()
  memoryBytes = 0

  const db = await openFileCacheDb()
  if (!db) {
    return
  }

  await new Promise<void>((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).clear()
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => resolve()
      transaction.onabort = () => resolve()
    } catch {
      dbPromise = null
      resolve()
    }
  })
}
