export type WorkspaceDataSource = 'mock' | 'server'

export type WorkspaceRuntimeConfiguration = {
  dataSource: WorkspaceDataSource
  apiBaseUrl: string
  apiTimeoutMs: number
  configurationError: string | null
}

const DEFAULT_API_BASE_URL = 'http://localhost:8080/api/v1'
const DEFAULT_API_TIMEOUT_MS = 10_000

function getWorkspaceEnvironment(): Partial<ImportMetaEnv> {
  return typeof import.meta.env === 'object' ? import.meta.env : {}
}

function normalizeApiBaseUrl(value: string | undefined) {
  const candidate = value?.trim() || DEFAULT_API_BASE_URL

  try {
    const url = new URL(candidate)

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return {
        value: DEFAULT_API_BASE_URL,
        error: 'VITE_WORKSPACE_API_BASE_URL은 http 또는 https URL이어야 합니다.',
      }
    }

    return { value: candidate.replace(/\/+$/, ''), error: null }
  } catch {
    return {
      value: DEFAULT_API_BASE_URL,
      error: 'VITE_WORKSPACE_API_BASE_URL이 올바른 URL 형식이 아닙니다.',
    }
  }
}

function normalizeApiTimeout(value: string | undefined) {
  if (!value?.trim()) {
    return { value: DEFAULT_API_TIMEOUT_MS, error: null }
  }

  const timeout = Number(value)

  if (!Number.isFinite(timeout) || timeout <= 0) {
    return {
      value: DEFAULT_API_TIMEOUT_MS,
      error: 'VITE_WORKSPACE_API_TIMEOUT_MS는 0보다 큰 숫자여야 합니다.',
    }
  }

  return { value: timeout, error: null }
}

export function resolveWorkspaceRuntimeConfiguration(
  environment: Partial<ImportMetaEnv>,
): WorkspaceRuntimeConfiguration {
  const rawDataSource = environment.VITE_WORKSPACE_DATA_SOURCE?.trim().toLowerCase()
  const dataSource: WorkspaceDataSource = rawDataSource === 'server' ? 'server' : 'mock'
  const sourceError =
    rawDataSource && rawDataSource !== 'mock' && rawDataSource !== 'server'
      ? 'VITE_WORKSPACE_DATA_SOURCE는 mock 또는 server여야 합니다.'
      : null
  const baseUrl = normalizeApiBaseUrl(environment.VITE_WORKSPACE_API_BASE_URL)
  const timeout = normalizeApiTimeout(environment.VITE_WORKSPACE_API_TIMEOUT_MS)

  return {
    dataSource,
    apiBaseUrl: baseUrl.value,
    apiTimeoutMs: timeout.value,
    configurationError:
      sourceError ?? (dataSource === 'server' ? baseUrl.error ?? timeout.error : null),
  }
}

export function getWorkspaceRuntimeConfiguration(): WorkspaceRuntimeConfiguration {
  return resolveWorkspaceRuntimeConfiguration(getWorkspaceEnvironment())
}

export function getWorkspaceDataSource() {
  return getWorkspaceRuntimeConfiguration().dataSource
}

export function isServerDataSource() {
  return getWorkspaceDataSource() === 'server'
}

export function isMockDataSource() {
  return getWorkspaceDataSource() === 'mock'
}

export function getWorkspaceApiBaseUrl() {
  const configuration = getWorkspaceRuntimeConfiguration()

  if (configuration.configurationError) {
    throw new Error(configuration.configurationError)
  }

  return configuration.apiBaseUrl
}

export function getWorkspaceApiTimeoutMs() {
  return getWorkspaceRuntimeConfiguration().apiTimeoutMs
}
