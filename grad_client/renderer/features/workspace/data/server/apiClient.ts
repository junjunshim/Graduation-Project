import { getWorkspaceApiBaseUrl, getWorkspaceApiTimeoutMs } from './workspaceMode.js'

const ACCESS_TOKEN_STORAGE_KEY = 'grad-client-server-access-token'
const LEGACY_REFRESH_TOKEN_STORAGE_KEY = 'grad-client-server-refresh-token'
const SERVER_EMAIL_STORAGE_KEY = 'grad-client-server-email'

export type ApiRequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  body?: unknown
  includeToken?: boolean
  signal?: AbortSignal
  timeoutMs?: number
}

export type ApiClientErrorKind = 'http' | 'network' | 'timeout' | 'aborted' | 'parse' | 'configuration'

type ApiErrorPayload = {
  code?: string | number
  message?: string
  detail?: unknown
}

export class ApiClientError extends Error {
  readonly kind: ApiClientErrorKind
  readonly status?: number
  readonly code?: string | number
  readonly detail?: unknown

  constructor(
    message: string,
    options: {
      kind: ApiClientErrorKind
      status?: number
      code?: string | number
      detail?: unknown
      cause?: unknown
    },
  ) {
    super(message)
    this.name = 'ApiClientError'
    ;(this as Error & { cause?: unknown }).cause = options.cause
    this.kind = options.kind
    this.status = options.status
    this.code = options.code
    this.detail = options.detail
  }
}

function hasStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function readStorageValue(key: string) {
  if (!hasStorage()) {
    return null
  }

  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorageValue(key: string, value: string | null) {
  if (!hasStorage()) {
    return
  }

  try {
    if (value) {
      window.localStorage.setItem(key, value)
      return
    }

    window.localStorage.removeItem(key)
  } catch {
    // Storage can be unavailable in hardened browser/Electron profiles.
  }
}

function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  return Boolean(value && typeof value === 'object')
}

function createRequestUrl(path: string) {
  const baseUrl = getWorkspaceApiBaseUrl()
  return `${baseUrl}/${path.replace(/^\/+/, '')}`
}

function getErrorMessage(payload: unknown, fallback: string) {
  if (isApiErrorPayload(payload) && typeof payload.message === 'string' && payload.message.trim()) {
    return payload.message
  }

  if (typeof payload === 'string' && payload.trim()) {
    return payload.trim()
  }

  return fallback
}

async function parseResponseBody(response: Response) {
  if (response.status === 204) {
    return null
  }

  const text = await response.text()

  if (!text.trim()) {
    return null
  }

  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    if (!response.ok) {
      return text
    }

    throw new ApiClientError('서버가 올바른 JSON 응답을 반환하지 않았습니다.', {
      kind: 'parse',
      status: response.status,
      cause: error,
    })
  }
}

export function getServerSessionEmail() {
  return readStorageValue(SERVER_EMAIL_STORAGE_KEY)
}

export function getServerAccessToken() {
  return readStorageValue(ACCESS_TOKEN_STORAGE_KEY)
}

export function hasServerSession() {
  return Boolean(getServerAccessToken() && getServerSessionEmail())
}

export function setServerSession({
  accessToken,
  email,
}: {
  accessToken: string
  email: string
}) {
  writeStorageValue(ACCESS_TOKEN_STORAGE_KEY, accessToken)
  writeStorageValue(LEGACY_REFRESH_TOKEN_STORAGE_KEY, null)
  writeStorageValue(SERVER_EMAIL_STORAGE_KEY, email)
}

export function clearServerSession() {
  writeStorageValue(ACCESS_TOKEN_STORAGE_KEY, null)
  writeStorageValue(LEGACY_REFRESH_TOKEN_STORAGE_KEY, null)
  writeStorageValue(SERVER_EMAIL_STORAGE_KEY, null)
}

export async function apiRequest<ResponseBody>(path: string, options: ApiRequestOptions = {}) {
  const headers = new Headers()
  headers.set('Accept', 'application/json')

  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }

  if (options.includeToken !== false) {
    const token = getServerAccessToken()

    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }
  }

  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? getWorkspaceApiTimeoutMs()
  let didTimeout = false
  const handleExternalAbort = () => controller.abort(options.signal?.reason)

  if (options.signal?.aborted) {
    handleExternalAbort()
  } else {
    options.signal?.addEventListener('abort', handleExternalAbort, { once: true })
  }

  const timeoutId = globalThis.setTimeout(() => {
    didTimeout = true
    controller.abort()
  }, timeoutMs)

  let response: Response
  let payload: unknown

  try {
    let url: string

    try {
      url = createRequestUrl(path)
    } catch (error) {
      throw new ApiClientError(
        error instanceof Error ? error.message : 'API 환경설정이 올바르지 않습니다.',
        { kind: 'configuration', cause: error },
      )
    }

    response = await fetch(url, {
      method: options.method ?? 'GET',
      headers,
      signal: controller.signal,
      // The checked-in server uses wildcard CORS, which cannot be combined with
      // credentialed requests. Refresh-cookie support must be enabled together
      // with the corresponding server CORS and cookie configuration.
      credentials: 'omit',
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    })
    payload = await parseResponseBody(response)
  } catch (error) {
    if (error instanceof ApiClientError) {
      throw error
    }

    if (didTimeout) {
      throw new ApiClientError(`서버 응답 시간이 ${timeoutMs}ms를 초과했습니다.`, {
        kind: 'timeout',
        cause: error,
      })
    }

    if (controller.signal.aborted) {
      throw new ApiClientError('서버 요청이 취소되었습니다.', {
        kind: 'aborted',
        cause: error,
      })
    }

    throw new ApiClientError('서버에 연결할 수 없습니다. 네트워크와 API 주소를 확인해 주세요.', {
      kind: 'network',
      cause: error,
    })
  } finally {
    globalThis.clearTimeout(timeoutId)
    options.signal?.removeEventListener('abort', handleExternalAbort)
  }

  if (!response.ok) {
    const errorPayload = isApiErrorPayload(payload) ? payload : null
    const fallbackMessage = `서버 요청에 실패했습니다. (HTTP ${response.status})`
    const publicMessage =
      response.status >= 500
        ? `서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해 주세요. (HTTP ${response.status})`
        : getErrorMessage(payload, fallbackMessage)

    throw new ApiClientError(
      publicMessage,
      {
        kind: 'http',
        status: response.status,
        ...(errorPayload?.code !== undefined ? { code: errorPayload.code } : {}),
        ...(errorPayload?.detail !== undefined ? { detail: errorPayload.detail } : {}),
      },
    )
  }

  return payload as ResponseBody
}
