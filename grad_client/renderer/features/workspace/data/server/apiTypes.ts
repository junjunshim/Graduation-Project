export type ServerResponseStatus = 'success' | 'error'

export type ServerErrorResponse = {
  status: 'error'
  code?: string | number
  message?: string
  detail?: unknown
}

export type ServerStatusResponse = {
  status: ServerResponseStatus
  code?: string | number
  message?: string
  data?: unknown
}

export type ServerLoginResponse = ServerStatusResponse & {
  access_token?: string
  refresh_token?: string
}

export type ServerLoginTokens = {
  accessToken: string
  refreshToken: string
}

export function getServerLoginTokens(response: ServerLoginResponse): ServerLoginTokens | null {
  if (
    response.status !== 'success' ||
    typeof response.access_token !== 'string' ||
    typeof response.refresh_token !== 'string'
  ) {
    return null
  }

  const accessToken = response.access_token.trim()
  const refreshToken = response.refresh_token.trim()

  if (!accessToken || !refreshToken) {
    return null
  }

  return { accessToken, refreshToken }
}

/**
 * The checked-in server currently emits a compact, polymorphic context item.
 * The additional fields cover the richer shape documented in docs/api so that
 * the adapter remains forward-compatible without leaking transport names into UI code.
 */
export type ServerContextItem = {
  type?: string
  id?: string | number
  node_id?: string | number
  node_type?: string
  parent_id?: string | number | null
  title?: string
  status?: string
  priority?: string | number
  extra_info?: unknown
  updated_at?: string

  path?: unknown
  user_id?: string
  user_name?: string
  email?: string
  user_email?: string
  role?: string
  role_name?: string
  authority?: string
  owner_node_id?: string | number
  owner_user_id?: string
  owner_user_email?: string
  owner_user_name?: string
  parent_work_item_id?: string | null
  description?: string | null
  category?: string | null
  weight?: string | number
  progress?: string | number
  comment_count?: string | number
  start_date?: string | null
  due_date?: string | null
  created_at?: string
  personal_node_id?: string | number | null
  name?: string
  hidden?: boolean
  is_deleted?: boolean

  comment_id?: string | number
  work_item_id?: string
  message?: string
  is_read?: boolean

  actor_user_id?: string
  actor_name?: string
  entity_type?: string
  entity_id?: string
  target_name?: string
  action_type?: string
  field_name?: string | null
  old_value?: string | null
  new_value?: string | null

  uploader_user_id?: string
  uploader_name?: string
  uploader_email?: string
  original_file_name?: string
  file_size?: string | number
  mime_type?: string | null
}

export type ServerContextResponse = ServerStatusResponse & {
  server_time?: unknown
  data?: unknown
}

export type ParsedServerContextResponse = {
  serverTime: string
  items: ServerContextItem[]
}

export function isServerStatusResponse(value: unknown): value is ServerStatusResponse {
  if (!value || typeof value !== 'object') {
    return false
  }

  const status = (value as Record<string, unknown>).status
  return status === 'success' || status === 'error'
}

export function parseServerContextItems(value: unknown): ServerContextItem[] {
  if (!Array.isArray(value)) {
    throw new Error('서버 컨텍스트 응답의 data가 배열 형식이 아닙니다.')
  }

  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`서버 컨텍스트 응답의 ${index + 1}번째 항목 형식이 올바르지 않습니다.`)
    }

    return item as ServerContextItem
  })
}

export function parseServerContextResponse(value: unknown): ParsedServerContextResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('서버 컨텍스트 응답 형식이 올바르지 않습니다.')
  }

  const response = value as Record<string, unknown>

  if (response.status !== 'success') {
    throw new Error('서버 컨텍스트 응답이 성공 형식이 아닙니다.')
  }

  if (typeof response.server_time !== 'string' || !response.server_time.trim()) {
    throw new Error('서버 컨텍스트 응답의 server_time이 올바르지 않습니다.')
  }

  return {
    serverTime: response.server_time.trim(),
    items: parseServerContextItems(response.data),
  }
}
