import { getWorkspaceApiBaseUrl } from './workspaceMode'

const ACCESS_TOKEN_STORAGE_KEY = 'grad-client-server-access-token'
const REFRESH_TOKEN_STORAGE_KEY = 'grad-client-server-refresh-token'
const SERVER_EMAIL_STORAGE_KEY = 'grad-client-server-email'

type ApiRequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH'
  body?: unknown
  includeToken?: boolean
}

type ApiErrorPayload = {
  message?: string
}

function hasStorage() {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function readStorageValue(key: string) {
  return hasStorage() ? window.localStorage.getItem(key) : null
}

function writeStorageValue(key: string, value: string | null) {
  if (!hasStorage()) {
    return
  }

  if (value) {
    window.localStorage.setItem(key, value)
    return
  }

  window.localStorage.removeItem(key)
}

function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  return Boolean(value && typeof value === 'object' && 'message' in value)
}

export function getServerSessionEmail() {
  return readStorageValue(SERVER_EMAIL_STORAGE_KEY)
}

export function getServerAccessToken() {
  return readStorageValue(ACCESS_TOKEN_STORAGE_KEY)
}

export function setServerSession({
  accessToken,
  refreshToken,
  email,
}: {
  accessToken: string
  refreshToken: string
  email: string
}) {
  writeStorageValue(ACCESS_TOKEN_STORAGE_KEY, accessToken)
  writeStorageValue(REFRESH_TOKEN_STORAGE_KEY, refreshToken)
  writeStorageValue(SERVER_EMAIL_STORAGE_KEY, email)
}

export function clearServerSession() {
  writeStorageValue(ACCESS_TOKEN_STORAGE_KEY, null)
  writeStorageValue(REFRESH_TOKEN_STORAGE_KEY, null)
  writeStorageValue(SERVER_EMAIL_STORAGE_KEY, null)
}

export async function apiRequest<ResponseBody>(path: string, options: ApiRequestOptions = {}) {
  const headers = new Headers()
  headers.set('Content-Type', 'application/json')

  if (options.includeToken !== false) {
    const token = getServerAccessToken()

    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }
  }

  const response = await fetch(`${getWorkspaceApiBaseUrl()}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })

  const text = await response.text()
  const payload = text ? (JSON.parse(text) as unknown) : null

  if (!response.ok) {
    const message = isApiErrorPayload(payload) ? payload.message : '서버 요청을 처리하지 못했습니다.'
    throw new Error(message)
  }

  return payload as ResponseBody
}
