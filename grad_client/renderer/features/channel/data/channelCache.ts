import { getServerSessionEmail } from '../../workspace/data/server/apiClient'
import type { ChatMessage, DmChannelItem, WorkspaceChannelItem } from '../model/channelTypes'

export type CachedChatSidebar = {
  workspaceChannels: WorkspaceChannelItem[]
  dmChannels: DmChannelItem[]
}

type SidebarCache = {
  key: string
  data: CachedChatSidebar
}

type MessageCache = {
  key: string
  byChannel: Map<number, ChatMessage[]>
}

let sidebarCache: SidebarCache | null = null
let messageCache: MessageCache | null = null

function resolveCacheKey() {
  return `server:${getServerSessionEmail() ?? ''}`
}

export function readCachedChatSidebar(): CachedChatSidebar | null {
  const key = resolveCacheKey()

  if (!sidebarCache || sidebarCache.key !== key) {
    sidebarCache = null
    return null
  }

  return sidebarCache.data
}

export function writeCachedChatSidebar(data: CachedChatSidebar) {
  sidebarCache = {
    key: resolveCacheKey(),
    data,
  }
}

function ensureMessageCache() {
  const key = resolveCacheKey()

  if (!messageCache || messageCache.key !== key) {
    messageCache = {
      key,
      byChannel: new Map(),
    }
  }

  return messageCache
}

export function readCachedChannelMessages(channelId: number): ChatMessage[] | null {
  const cache = ensureMessageCache()

  if (!cache.byChannel.has(channelId)) {
    return null
  }

  return cache.byChannel.get(channelId) ?? null
}

export function writeCachedChannelMessages(channelId: number, messages: ChatMessage[]) {
  ensureMessageCache().byChannel.set(channelId, messages)
}

export function removeCachedChannelMessages(channelId: number) {
  ensureMessageCache().byChannel.delete(channelId)
}

export function pruneCachedChannelMessages(validChannelIds: ReadonlySet<number>) {
  const cache = ensureMessageCache()

  cache.byChannel.forEach((_, channelId) => {
    if (!validChannelIds.has(channelId)) {
      cache.byChannel.delete(channelId)
    }
  })
}
