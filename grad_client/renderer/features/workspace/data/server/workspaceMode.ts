export type WorkspaceDataSource = 'local' | 'server'

const SERVER_SOURCE_VALUE = 'server'
const DEFAULT_API_BASE_URL = 'http://localhost:8080/api/v1'

export function getWorkspaceDataSource(): WorkspaceDataSource {
  return import.meta.env.VITE_WORKSPACE_DATA_SOURCE === SERVER_SOURCE_VALUE ? 'server' : 'local'
}

export function isServerDataSource() {
  return getWorkspaceDataSource() === 'server'
}

export function getWorkspaceApiBaseUrl() {
  return import.meta.env.VITE_WORKSPACE_API_BASE_URL ?? DEFAULT_API_BASE_URL
}
