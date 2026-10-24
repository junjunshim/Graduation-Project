import {
  apiRequest,
  getServerAccessToken,
  refreshServerTokens,
} from '../../workspace/data/server/apiClient'
import { isServerStatusResponse } from '../../workspace/data/server/apiTypes'
import { getWorkspaceApiBaseUrl } from '../../workspace/data/server/workspaceMode'
import { invalidateQueryCache, queryWithCache } from '../../workspace/data/queryCache.js'
import type {
  ChannelParticipant,
  ChatMessage,
  ChatMessageFile,
  DmChannelItem,
  WorkspaceChannelItem,
} from '../model/channelTypes'

const CHAT_SIDEBAR_CACHE_TTL_MS = 60_000
const CHAT_MESSAGES_CACHE_TTL_MS = 30_000
const CHAT_THREADS_CACHE_TTL_MS = 30_000

export function invalidateChatSidebarCache() {
  invalidateQueryCache('chat:sidebar')
}

export function invalidateChatMessagesCache(channelId?: number) {
  invalidateQueryCache(
    channelId && channelId > 0 ? `chat:messages:${channelId}:` : 'chat:messages:',
  )
}

export function invalidateChatThreadsCache(parentMessageId?: number) {
  invalidateQueryCache(
    parentMessageId && parentMessageId > 0 ? `chat:thread:${parentMessageId}` : 'chat:thread:',
  )
}

function invalidateChatAfterMessageMutation(channelId?: number) {
  invalidateChatSidebarCache()
  invalidateChatMessagesCache(channelId)
  invalidateChatThreadsCache()
}

function extractDataArray(response: unknown): Array<Record<string, unknown>> {
  if (!response || typeof response !== 'object') {
    return []
  }

  const root = response as Record<string, unknown>
  if (root.status === 'error') {
    throw new Error(typeof root.message === 'string' ? root.message : '요청 처리에 실패했습니다.')
  }

  if (Array.isArray(root.data)) {
    return root.data.filter(
      (item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'),
    )
  }

  if (root.data && typeof root.data === 'object') {
    return [root.data as Record<string, unknown>]
  }

  return []
}

export function normalizeChatMessageFile(
  raw: Record<string, unknown>,
  fallbackMessageId = 0,
): ChatMessageFile {
  return {
    fileId: Number(raw.file_id ?? raw.fileId ?? raw.id ?? 0),
    messageId: Number(raw.message_id ?? raw.messageId ?? fallbackMessageId),
    originalFileName: String(
      raw.original_file_name ?? raw.originalFileName ?? `file_${raw.file_id ?? 0}`,
    ),
    fileSize: Number(raw.file_size ?? raw.fileSize ?? 0),
    mimeType:
      raw.mime_type !== undefined && raw.mime_type !== null
        ? String(raw.mime_type)
        : raw.mimeType !== undefined && raw.mimeType !== null
          ? String(raw.mimeType)
          : null,
    createdAt: String(raw.created_at ?? raw.createdAt ?? new Date().toISOString()),
  }
}

export function normalizeChannelParticipants(raw: unknown): ChannelParticipant[] {
  if (!Array.isArray(raw)) {
    return []
  }

  const seen = new Set<string>()
  const participants: ChannelParticipant[] = []

  raw.forEach((item) => {
    if (!item || typeof item !== 'object') {
      return
    }

    const record = item as Record<string, unknown>
    const email = String(record.email ?? '').trim().toLowerCase()
    if (!email || seen.has(email)) {
      return
    }

    seen.add(email)
    participants.push({
      email,
      name: String(record.name ?? email),
      online: record.online === true,
    })
  })

  return participants.sort((a, b) => {
    if (a.online !== b.online) {
      return a.online ? -1 : 1
    }
    return a.name.localeCompare(b.name, 'ko')
  })
}

export function normalizeChatMessage(raw: Record<string, unknown>): ChatMessage {
  const messageId = Number(raw.message_id ?? raw.messageId ?? raw.id ?? 0)
  const rawFiles = Array.isArray(raw.files) ? raw.files : []
  const files = rawFiles
    .filter((f): f is Record<string, unknown> => Boolean(f && typeof f === 'object'))
    .map((f) => normalizeChatMessageFile(f, messageId))

  const parentRaw = raw.parent_message_id ?? raw.parentMessageId
  const parentMessageId =
    parentRaw !== undefined && parentRaw !== null && Number(parentRaw) > 0
      ? Number(parentRaw)
      : null

  const rawReplySenders = Array.isArray(raw.reply_senders) ? raw.reply_senders : []
  const replySenders = rawReplySenders
    .filter((sender): sender is Record<string, unknown> =>
      Boolean(sender && typeof sender === 'object'),
    )
    .map((sender) => ({
      email: String(sender.email ?? ''),
      name: String(sender.name ?? sender.email ?? '알 수 없음'),
    }))

  return {
    messageId,
    channelId: Number(raw.channel_id ?? raw.channelId ?? 0),
    parentMessageId,
    senderUserId: String(raw.sender_user_id ?? raw.senderUserId ?? ''),
    senderEmail: String(raw.sender_email ?? raw.senderEmail ?? ''),
    senderName: String(
      raw.sender_name ?? raw.senderName ?? raw.sender_email ?? raw.senderUserId ?? '알 수 없음',
    ),
    content: String(raw.content ?? ''),
    isEdited: Boolean(raw.is_edited ?? raw.isEdited),
    isDeleted: Boolean(raw.is_deleted ?? raw.isDeleted),
    replyCount: Number(raw.reply_count ?? raw.replyCount ?? 0),
    lastReplyAt:
      typeof raw.last_reply_at === 'string'
        ? raw.last_reply_at
        : typeof raw.lastReplyAt === 'string'
          ? raw.lastReplyAt
          : null,
    replySenders,
    files,
    createdAt: String(raw.created_at ?? raw.createdAt ?? new Date().toISOString()),
    updatedAt: String(
      raw.updated_at ?? raw.updatedAt ?? raw.created_at ?? new Date().toISOString(),
    ),
  }
}

export function normalizeWorkspaceChannel(raw: Record<string, unknown>): WorkspaceChannelItem {
  return {
    channelId: Number(raw.channel_id ?? raw.channelId ?? raw.id ?? 0),
    channelType: 'WORKSPACE',
    ownerNodeId: Number(raw.owner_node_id ?? raw.ownerNodeId ?? raw.node_id ?? 0),
    ownerNodeName: String(raw.owner_node_name ?? raw.ownerNodeName ?? '워크스페이스'),
    ownerNodeType:
      typeof raw.owner_node_type === 'string'
        ? raw.owner_node_type
        : typeof raw.ownerNodeType === 'string'
          ? raw.ownerNodeType
          : undefined,
    name: String(raw.name ?? '일반'),
    description: String(raw.description ?? ''),
    isDefault: Boolean(raw.is_default ?? raw.isDefault),
    canChat: raw.can_chat !== undefined ? Boolean(raw.can_chat) : Boolean(raw.canChat ?? true),
    canManage:
      raw.can_manage !== undefined ? Boolean(raw.can_manage) : Boolean(raw.canManage ?? false),
    unreadCount: Number(raw.unread_count ?? raw.unreadCount ?? 0),
    lastMessagePreview: String(raw.last_message_preview ?? raw.lastMessagePreview ?? ''),
    lastMessageSenderName: String(
      raw.last_message_sender_name ?? raw.lastMessageSenderName ?? '',
    ),
    lastMessageAt: String(
      raw.last_message_at ?? raw.lastMessageAt ?? raw.created_at ?? new Date().toISOString(),
    ),
    createdAt: String(raw.created_at ?? raw.createdAt ?? new Date().toISOString()),
  }
}

export function normalizeDmChannel(raw: Record<string, unknown>): DmChannelItem {
  const counterpartEmail = String(raw.counterpart_email ?? raw.counterpartEmail ?? '')
  return {
    channelId: Number(raw.channel_id ?? raw.channelId ?? raw.id ?? 0),
    channelType: 'DM',
    counterpartUserId: String(
      raw.counterpart_user_id ?? raw.counterpartUserId ?? counterpartEmail,
    ),
    counterpartEmail,
    counterpartName: String(
      raw.counterpart_name ?? raw.counterpartName ?? counterpartEmail ?? '대화 상대',
    ),
    canChat: raw.can_chat !== undefined ? Boolean(raw.can_chat) : Boolean(raw.canChat ?? true),
    canManage:
      raw.can_manage !== undefined ? Boolean(raw.can_manage) : Boolean(raw.canManage ?? false),
    unreadCount: Number(raw.unread_count ?? raw.unreadCount ?? 0),
    lastMessagePreview: String(raw.last_message_preview ?? raw.lastMessagePreview ?? ''),
    lastMessageSenderName: String(
      raw.last_message_sender_name ?? raw.lastMessageSenderName ?? '',
    ),
    lastMessageAt: String(
      raw.last_message_at ?? raw.lastMessageAt ?? raw.created_at ?? new Date().toISOString(),
    ),
    createdAt: String(raw.created_at ?? raw.createdAt ?? new Date().toISOString()),
  }
}

export async function fetchChatSidebar(options: { forceRefresh?: boolean } = {}): Promise<{
  workspaceChannels: WorkspaceChannelItem[]
  dmChannels: DmChannelItem[]
}> {
  return queryWithCache('chat:sidebar', fetchChatSidebarFromServer, {
    ttlMs: CHAT_SIDEBAR_CACHE_TTL_MS,
    forceRefresh: options.forceRefresh,
  })
}

async function fetchChatSidebarFromServer(): Promise<{
  workspaceChannels: WorkspaceChannelItem[]
  dmChannels: DmChannelItem[]
}> {
  const response = await apiRequest<unknown>('/channels/sidebar')
  const items = extractDataArray(response)

  const workspaceChannels: WorkspaceChannelItem[] = []
  const dmChannels: DmChannelItem[] = []

  items.forEach((item) => {
    const itemType = String(item.type ?? item.channel_type ?? '').toUpperCase()
    if (itemType === 'DM_CHANNEL' || itemType === 'DM' || item.channel_type === 'DM') {
      const dm = normalizeDmChannel(item)
      if (dm.channelId > 0) {
        dmChannels.push(dm)
      }
    } else if (
      itemType === 'WORKSPACE_CHANNEL' ||
      itemType === 'WORKSPACE' ||
      item.channel_type === 'WORKSPACE' ||
      item.owner_node_id !== undefined
    ) {
      const ws = normalizeWorkspaceChannel(item)
      if (ws.channelId > 0) {
        workspaceChannels.push(ws)
      }
    }
  })

  return { workspaceChannels, dmChannels }
}

export async function createWorkspaceChannel(
  nodeId: number,
  name: string,
  description: string,
): Promise<WorkspaceChannelItem> {
  const response = await apiRequest<unknown>('/channels', {
    method: 'POST',
    body: {
      node_id: nodeId,
      name: name.trim(),
      description: description.trim(),
    },
  })

  const items = extractDataArray(response)
  const found =
    items.find(
      (item) =>
        String(item.type ?? '').toUpperCase() === 'WORKSPACE_CHANNEL' ||
        item.channel_id !== undefined,
    ) ?? items[0]

  if (!found) {
    throw new Error('생성된 채널 정보를 받지 못했습니다.')
  }

  const channel = normalizeWorkspaceChannel(found)
  invalidateChatSidebarCache()
  return channel
}

export async function updateWorkspaceChannel(
  channelId: number,
  name: string,
  description: string,
): Promise<WorkspaceChannelItem> {
  const response = await apiRequest<unknown>('/channels', {
    method: 'PATCH',
    body: {
      channel_id: channelId,
      name: name.trim(),
      description: description.trim(),
    },
  })

  const items = extractDataArray(response)
  const found =
    items.find(
      (item) =>
        String(item.type ?? '').toUpperCase() === 'WORKSPACE_CHANNEL' ||
        item.channel_id !== undefined,
    ) ?? items[0]

  if (!found) {
    throw new Error('수정된 채널 정보를 받지 못했습니다.')
  }

  const channel = normalizeWorkspaceChannel(found)
  invalidateChatSidebarCache()
  return channel
}

export async function deleteWorkspaceChannel(channelId: number): Promise<void> {
  const response = await apiRequest<unknown>('/channels', {
    method: 'DELETE',
    body: {
      channel_id: channelId,
    },
  })

  if (isServerStatusResponse(response) && response.status === 'error') {
    throw new Error(response.message ?? '채널을 삭제하지 못했습니다.')
  }

  invalidateChatSidebarCache()
  invalidateChatMessagesCache(channelId)
}

export async function openOrCreateDmChannel(targetEmail: string): Promise<DmChannelItem> {
  const response = await apiRequest<unknown>('/channels/dm', {
    method: 'POST',
    body: {
      target_email: targetEmail.trim().toLowerCase(),
    },
  })

  const items = extractDataArray(response)
  const found =
    items.find(
      (item) =>
        String(item.type ?? '').toUpperCase() === 'DM_CHANNEL' ||
        item.channel_type === 'DM' ||
        item.channel_id !== undefined,
    ) ?? items[0]

  if (!found) {
    throw new Error('다이렉트 메시지 채널 정보를 받지 못했습니다.')
  }

  const channel = normalizeDmChannel(found)
  invalidateChatSidebarCache()
  return channel
}

export async function fetchChannelMessages(
  channelId: number,
  beforeMessageId?: number,
  limit = 80,
  options: { forceRefresh?: boolean } = {},
): Promise<ChatMessage[]> {
  const before = beforeMessageId && beforeMessageId > 0 ? beforeMessageId : 0
  return queryWithCache(
    `chat:messages:${channelId}:${limit}:${before}`,
    () => fetchChannelMessagesFromServer(channelId, beforeMessageId, limit),
    { ttlMs: CHAT_MESSAGES_CACHE_TTL_MS, forceRefresh: options.forceRefresh },
  )
}

async function fetchChannelMessagesFromServer(
  channelId: number,
  beforeMessageId?: number,
  limit = 80,
): Promise<ChatMessage[]> {
  const params = new URLSearchParams({
    channel_id: String(channelId),
    limit: String(limit),
  })
  if (beforeMessageId && beforeMessageId > 0) {
    params.set('before_message_id', String(beforeMessageId))
  }

  const response = await apiRequest<unknown>(`/channels/messages?${params.toString()}`)
  const items = extractDataArray(response)

  return items
    .filter((item) => {
      const t = String(item.type ?? 'CHAT_MESSAGE').toUpperCase()
      return t === 'CHAT_MESSAGE' || item.message_id !== undefined
    })
    .map((item) => normalizeChatMessage(item))
    .sort((a, b) => a.messageId - b.messageId)
}

export async function fetchThreadMessages(
  parentMessageId: number,
  options: { forceRefresh?: boolean } = {},
): Promise<{
  parent: ChatMessage | null
  replies: ChatMessage[]
}> {
  return queryWithCache(
    `chat:thread:${parentMessageId}`,
    () => fetchThreadMessagesFromServer(parentMessageId),
    { ttlMs: CHAT_THREADS_CACHE_TTL_MS, forceRefresh: options.forceRefresh },
  )
}

async function fetchThreadMessagesFromServer(parentMessageId: number): Promise<{
  parent: ChatMessage | null
  replies: ChatMessage[]
}> {
  const params = new URLSearchParams({
    parent_message_id: String(parentMessageId),
  })
  const response = await apiRequest<unknown>(`/channels/threads?${params.toString()}`)
  const items = extractDataArray(response)

  let parent: ChatMessage | null = null
  const replies: ChatMessage[] = []

  items.forEach((item) => {
    const itemType = String(item.type ?? '').toUpperCase()
    const normalized = normalizeChatMessage(item)
    if (
      itemType === 'THREAD_PARENT' ||
      normalized.messageId === parentMessageId ||
      normalized.parentMessageId === null
    ) {
      if (!parent || normalized.messageId === parentMessageId) {
        parent = normalized
        return
      }
    }
    replies.push(normalized)
  })

  replies.sort((a, b) => a.messageId - b.messageId)
  return { parent, replies }
}

export async function sendChatMessage(
  channelId: number,
  content: string,
  parentMessageId?: number | null,
): Promise<ChatMessage> {
  const response = await apiRequest<unknown>('/channels/messages', {
    method: 'POST',
    body: {
      channel_id: channelId,
      parent_message_id: parentMessageId ?? null,
      content,
    },
  })

  const items = extractDataArray(response)
  const found =
    items.find(
      (item) =>
        String(item.type ?? '').toUpperCase() === 'CHAT_MESSAGE' ||
        item.message_id !== undefined,
    ) ?? items[0]

  if (!found) {
    throw new Error('전송된 메시지 정보를 받지 못했습니다.')
  }

  const message = normalizeChatMessage(found)
  invalidateChatAfterMessageMutation(channelId)
  return message
}

export async function updateChatMessage(
  messageId: number,
  content: string,
): Promise<ChatMessage> {
  const response = await apiRequest<unknown>('/channels/messages', {
    method: 'PATCH',
    body: {
      message_id: messageId,
      content,
    },
  })

  const items = extractDataArray(response)
  const found =
    items.find(
      (item) =>
        String(item.type ?? '').toUpperCase() === 'CHAT_MESSAGE' ||
        item.message_id !== undefined,
    ) ?? items[0]

  if (!found) {
    throw new Error('수정된 메시지 정보를 받지 못했습니다.')
  }

  const message = normalizeChatMessage(found)
  invalidateChatAfterMessageMutation()
  return message
}

export async function deleteChatMessage(messageId: number): Promise<void> {
  const response = await apiRequest<unknown>('/channels/messages', {
    method: 'DELETE',
    body: {
      message_id: messageId,
    },
  })

  if (isServerStatusResponse(response) && response.status === 'error') {
    throw new Error(response.message ?? '메시지를 삭제하지 못했습니다.')
  }

  invalidateChatAfterMessageMutation()
}

export async function uploadChatMessageFile(
  messageId: number,
  file: File,
): Promise<ChatMessage | null> {
  const formData = new FormData()
  formData.append('message_id', String(messageId))
  formData.append('file', file)

  const response = await apiRequest<unknown>('/channels/files/upload', {
    method: 'POST',
    formData,
  })

  const items = extractDataArray(response)
  const found =
    items.find(
      (item) =>
        String(item.type ?? '').toUpperCase() === 'CHAT_MESSAGE' ||
        item.message_id !== undefined,
    ) ?? items[0]

  const message = found ? normalizeChatMessage(found) : null
  invalidateChatAfterMessageMutation()
  return message
}

async function fetchFileBlobFromServer(fileId: number, inline = false): Promise<Blob> {
  const baseUrl = getWorkspaceApiBaseUrl()
  const params = new URLSearchParams({
    file_id: String(fileId),
  })
  if (inline) {
    params.set('inline', 'true')
  }
  const url = `${baseUrl}/channels/files/download?${params.toString()}`

  const performFetch = async (token: string | null) => {
    const headers = new Headers()
    if (token) {
      headers.set('Authorization', `Bearer ${token}`)
    }
    return fetch(url, {
      method: 'GET',
      headers,
      credentials: 'omit',
    })
  }

  let response = await performFetch(getServerAccessToken())
  if (response.status === 401) {
    const refreshed = await refreshServerTokens()
    if (refreshed) {
      response = await performFetch(refreshed)
    }
  }

  if (!response.ok) {
    throw new Error(`파일을 불러오지 못했습니다. (HTTP ${response.status})`)
  }

  return response.blob()
}

const blobUrlCache = new Map<number, string>()

export async function fetchChatFileBlobUrl(fileId: number): Promise<string> {
  const cached = blobUrlCache.get(fileId)
  if (cached) {
    return cached
  }

  const blob = await fetchFileBlobFromServer(fileId, true)
  const objectUrl = URL.createObjectURL(blob)
  blobUrlCache.set(fileId, objectUrl)
  return objectUrl
}

export async function downloadChatFile(fileId: number, fileName: string): Promise<void> {
  const blob = await fetchFileBlobFromServer(fileId, false)
  const objectUrl = URL.createObjectURL(blob)
  try {
    const anchor = document.createElement('a')
    anchor.href = objectUrl
    anchor.download = fileName || `attachment_${fileId}`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
  } finally {
    setTimeout(() => URL.revokeObjectURL(objectUrl), 5000)
  }
}

export async function markChannelAsRead(channelId: number): Promise<void> {
  try {
    await apiRequest<unknown>('/channels/read', {
      method: 'POST',
      body: {
        channel_id: channelId,
      },
    })
  } catch {
    // 읽음 처리는 백그라운드 보조 동작이므로 실패 시 조용히 무시
  }
}
