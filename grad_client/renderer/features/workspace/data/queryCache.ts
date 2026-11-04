import { getServerSessionEmail } from './server/apiClient.js'

type CacheEntry = {
  data: unknown
  updatedAt: number
}

type InFlightEntry = {
  promise: Promise<unknown>
  requestId: number
}

export type QueryCacheOptions = {
  ttlMs: number
  forceRefresh?: boolean
}

const cache = new Map<string, CacheEntry>()
const inFlight = new Map<string, InFlightEntry>()
const latestRequestByKey = new Map<string, number>()

let requestSequence = 0

function isFresh(entry: CacheEntry | undefined, ttlMs: number) {
  return Boolean(entry && Date.now() - entry.updatedAt < ttlMs)
}

function hasKeyPrefix(key: string, prefix: string) {
  return key.startsWith(prefix)
}

function resolveScopedKey(key: string) {
  return `${getServerSessionEmail() ?? 'anonymous'}::${key}`
}

function invalidateMatchingKeys(predicate: (key: string) => boolean) {
  for (const key of cache.keys()) {
    if (predicate(key)) {
      cache.delete(key)
    }
  }

  for (const key of inFlight.keys()) {
    if (predicate(key)) {
      inFlight.delete(key)
      latestRequestByKey.delete(key)
    }
  }
}

/**
 * GET 성격의 조회를 짧은 TTL 동안 재사용한다.
 * - fresh: 네트워크 요청 없이 캐시 반환
 * - stale: 새 요청 1회 수행
 * - 동시 요청: 진행 중인 Promise 공유
 * - 실패: 캐시하지 않으므로 다음 호출에서 재시도
 */
export function queryWithCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  options: QueryCacheOptions,
): Promise<T> {
  const scopedKey = resolveScopedKey(key)
  const cached = cache.get(scopedKey)
  if (!options.forceRefresh && isFresh(cached, options.ttlMs)) {
    return Promise.resolve(cached?.data as T)
  }

  if (!options.forceRefresh) {
    const pending = inFlight.get(scopedKey)
    if (pending) {
      return pending.promise as Promise<T>
    }
  }

  const requestId = ++requestSequence
  latestRequestByKey.set(scopedKey, requestId)

  const promise = fetcher().then((data) => {
    // 무효화 이후 도착한 이전 요청이 최신 캐시를 덮어쓰지 않게 한다.
    if (latestRequestByKey.get(scopedKey) === requestId) {
      cache.set(scopedKey, { data, updatedAt: Date.now() })
    }
    return data
  })

  inFlight.set(scopedKey, { promise, requestId })
  promise.then(
    () => {
      if (inFlight.get(scopedKey)?.requestId === requestId) {
        inFlight.delete(scopedKey)
      }
    },
    () => {
      if (inFlight.get(scopedKey)?.requestId === requestId) {
        inFlight.delete(scopedKey)
      }
    },
  )

  return promise
}

export function invalidateQueryCache(prefix?: string) {
  if (!prefix) {
    cache.clear()
    inFlight.clear()
    latestRequestByKey.clear()
    return
  }

  const scopedPrefix = resolveScopedKey(prefix)
  invalidateMatchingKeys((key) => hasKeyPrefix(key, scopedPrefix))
}

export function clearQueryCacheForTests() {
  cache.clear()
  inFlight.clear()
  latestRequestByKey.clear()
  requestSequence = 0
}
