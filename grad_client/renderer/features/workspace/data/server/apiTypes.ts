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
}

export function getServerLoginAccessToken(response: ServerLoginResponse) {
  if (response.status !== 'success' || typeof response.access_token !== 'string') {
    return null
  }

  return response.access_token.trim() || null
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
  email?: string
  user_email?: string
  role?: string
  role_name?: string
  authority?: string
  owner_node_id?: string | number
  owner_user_id?: string
  owner_user_email?: string
  parent_work_item_id?: string | null
  description?: string
  weight?: string | number
  progress?: string | number
  start_date?: string | null
  due_date?: string | null
  created_at?: string
  personal_node_id?: string | number | null
  name?: string
  hidden?: boolean

  comment_id?: string | number
  work_item_id?: string
  message?: string
  is_read?: boolean
}

export type ServerContextResponse = ServerStatusResponse & {
  data?: unknown
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
