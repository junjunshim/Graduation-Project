/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WORKSPACE_DATA_SOURCE: 'mock' | 'server'
  readonly VITE_WORKSPACE_API_BASE_URL: string
  readonly VITE_WORKSPACE_API_TIMEOUT_MS: string
  readonly VITE_WORKSPACE_MOCK_SCENARIO?: 'default' | 'empty' | 'boundary' | 'error'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
