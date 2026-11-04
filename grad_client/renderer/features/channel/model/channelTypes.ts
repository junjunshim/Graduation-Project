export type WorkspaceChannelItem = {
  channelId: number
  channelType: 'WORKSPACE'
  ownerNodeId: number
  ownerNodeName: string
  ownerNodeType?: string
  name: string
  description: string
  isDefault: boolean
  canChat: boolean
  canManage: boolean
  unreadCount: number
  lastMessagePreview: string
  lastMessageSenderName: string
  lastMessageAt: string
  createdAt: string
}

export type DmChannelItem = {
  channelId: number
  channelType: 'DM'
  counterpartUserId: string
  counterpartEmail: string
  counterpartName: string
  canChat: boolean
  canManage: boolean
  unreadCount: number
  lastMessagePreview: string
  lastMessageSenderName: string
  lastMessageAt: string
  createdAt: string
}

export type ChannelItem = WorkspaceChannelItem | DmChannelItem

export type ChannelParticipant = {
  email: string
  name: string
  online: boolean
}

export type ChatMessageFile = {
  fileId: number
  messageId: number
  originalFileName: string
  fileSize: number
  mimeType: string | null
  createdAt: string
}

export type ChatMessageSender = {
  email: string
  name: string
}

export type ChatMessage = {
  messageId: number
  channelId: number
  parentMessageId: number | null
  senderUserId: string
  senderEmail: string
  senderName: string
  content: string
  isEdited: boolean
  isDeleted: boolean
  replyCount: number
  lastReplyAt: string | null
  replySenders: ChatMessageSender[]
  files: ChatMessageFile[]
  createdAt: string
  updatedAt: string
}
