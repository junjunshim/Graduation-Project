import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getCurrentUser } from '../../auth/api'
import { getOrgSnapshot } from '../../workspace/data/orgService'
import {
  joinChannelPresence,
  leaveChannelPresence,
} from '../../workspace/data/server/serverWorkspace'
import {
  subscribeToChatRealtimeEvents,
  subscribeToWorkspaceCache,
} from '../../workspace/data/workspaceCacheEvents'
import { parseAuthorityBitSet } from '../../workspace/model/authorityDefinitions'
import {
  pruneCachedChannelMessages,
  readCachedChannelMessages,
  readCachedChatSidebar,
  removeCachedChannelMessages,
  writeCachedChannelMessages,
  writeCachedChatSidebar,
} from '../data/channelCache'
import {
  createWorkspaceChannel,
  deleteChatMessage,
  deleteWorkspaceChannel,
  fetchChannelMessages,
  fetchChatSidebar,
  fetchThreadMessages,
  markChannelAsRead,
  normalizeChannelParticipants,
  normalizeChatMessage,
  openOrCreateDmChannel,
  sendChatMessage,
  updateChatMessage,
  updateWorkspaceChannel,
  uploadChatMessageFile,
} from '../api/channelApi'
import type {
  ChannelParticipant,
  ChannelItem,
  ChatMessage,
  DmChannelItem,
  WorkspaceChannelItem,
} from '../model/channelTypes'
import { ChannelMainChat } from '../ui/ChannelMainChat'
import {
  ChannelFormModal,
  NewDmModal,
  type ManageableWorkspaceOption,
} from '../ui/ChannelModals'
import { ChannelSidebar, type WorkspaceGroup } from '../ui/ChannelSidebar'
import { ChannelThreadPanel } from '../ui/ChannelThreadPanel'
import styles from './ChannelsPage.module.css'

export function ChannelsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [snapshot, setSnapshot] = useState(() => getOrgSnapshot())
  const currentUser = getCurrentUser(snapshot)

  const [initialSidebarCache] = useState(() => readCachedChatSidebar())
  const [workspaceChannels, setWorkspaceChannels] = useState<WorkspaceChannelItem[]>(
    () => initialSidebarCache?.workspaceChannels ?? [],
  )
  const [dmChannels, setDmChannels] = useState<DmChannelItem[]>(
    () => initialSidebarCache?.dmChannels ?? [],
  )
  const [selectedChannelId, setSelectedChannelId] = useState<number | null>(() => {
    const param = Number(searchParams.get('channelId'))
    if (Number.isFinite(param) && param > 0) {
      return param
    }
    return (
      initialSidebarCache?.workspaceChannels[0]?.channelId ??
      initialSidebarCache?.dmChannels[0]?.channelId ??
      null
    )
  })

  const [initialMessageCache] = useState(() =>
    selectedChannelId ? readCachedChannelMessages(selectedChannelId) : null,
  )
  const [messages, setMessages] = useState<ChatMessage[]>(() => initialMessageCache ?? [])
  const [isLoadingMessages, setIsLoadingMessages] = useState(
    () => Boolean(selectedChannelId) && initialMessageCache === null,
  )
  const [channelParticipants, setChannelParticipants] = useState<ChannelParticipant[]>([])
  const [isChannelPresenceReady, setIsChannelPresenceReady] = useState(false)

  const [activeThreadParent, setActiveThreadParent] = useState<ChatMessage | null>(null)
  const [threadReplies, setThreadReplies] = useState<ChatMessage[]>([])
  const [isLoadingThread, setIsLoadingThread] = useState(false)

  const [channelModalMode, setChannelModalMode] = useState<'create' | 'edit' | null>(null)
  const [modalInitialNodeId, setModalInitialNodeId] = useState<number | undefined>(undefined)
  const [isNewDmModalOpen, setIsNewDmModalOpen] = useState(false)
  const [bannerError, setBannerError] = useState<string | null>(null)

  const selectedChannelIdRef = useRef<number | null>(selectedChannelId)
  selectedChannelIdRef.current = selectedChannelId

  const messagesChannelIdRef = useRef<number | null>(selectedChannelId)
  const messagesReadyChannelIdRef = useRef<number | null>(
    selectedChannelId && initialMessageCache ? selectedChannelId : null,
  )
  const messageRequestIdRef = useRef(0)

  const activeThreadParentIdRef = useRef<number | null>(activeThreadParent?.messageId ?? null)
  activeThreadParentIdRef.current = activeThreadParent?.messageId ?? null

  useEffect(() => {
    return subscribeToWorkspaceCache(() => {
      setSnapshot(getOrgSnapshot())
    })
  }, [])

  useEffect(() => {
    writeCachedChatSidebar({ workspaceChannels, dmChannels })
  }, [workspaceChannels, dmChannels])

  useEffect(() => {
    const channelId = messagesChannelIdRef.current
    if (!channelId || messagesReadyChannelIdRef.current !== channelId) return
    writeCachedChannelMessages(channelId, messages)
  }, [messages])

  const loadSidebar = useCallback(async () => {
    try {
      const data = await fetchChatSidebar()
      setWorkspaceChannels(data.workspaceChannels)
      setDmChannels(data.dmChannels)

      const knownChannelIds = new Set([
        ...data.workspaceChannels.map((c) => c.channelId),
        ...data.dmChannels.map((d) => d.channelId),
      ])
      pruneCachedChannelMessages(knownChannelIds)

      setSelectedChannelId((currentId) => {
        if (currentId && knownChannelIds.has(currentId)) {
          return currentId
        }
        const firstId =
          data.workspaceChannels[0]?.channelId ?? data.dmChannels[0]?.channelId ?? null
        return firstId
      })
    } catch (error) {
      setBannerError(
        error instanceof Error && error.message
          ? error.message
          : '채널 목록을 불러오지 못했습니다.',
      )
    }
  }, [])

  useEffect(() => {
    void loadSidebar()
  }, [loadSidebar])

  const loadChannelMessages = useCallback(async (channelId: number) => {
    const requestId = messageRequestIdRef.current + 1
    messageRequestIdRef.current = requestId

    const cached = readCachedChannelMessages(channelId)
    messagesChannelIdRef.current = channelId
    messagesReadyChannelIdRef.current = cached ? channelId : null
    setMessages(cached ?? [])
    setIsLoadingMessages(cached === null)

    try {
      const list = await fetchChannelMessages(channelId)
      writeCachedChannelMessages(channelId, list)

      if (
        selectedChannelIdRef.current !== channelId ||
        messageRequestIdRef.current !== requestId
      ) {
        return
      }

      messagesReadyChannelIdRef.current = channelId
      setMessages(list)
      setWorkspaceChannels((prev) =>
        prev.map((ch) => (ch.channelId === channelId ? { ...ch, unreadCount: 0 } : ch)),
      )
      setDmChannels((prev) =>
        prev.map((dm) => (dm.channelId === channelId ? { ...dm, unreadCount: 0 } : dm)),
      )
      void markChannelAsRead(channelId)
    } catch (error) {
      if (
        selectedChannelIdRef.current !== channelId ||
        messageRequestIdRef.current !== requestId
      ) {
        return
      }

      setBannerError(
        error instanceof Error && error.message
          ? error.message
          : '메시지를 불러오지 못했습니다.',
      )
    } finally {
      if (
        selectedChannelIdRef.current === channelId &&
        messageRequestIdRef.current === requestId
      ) {
        setIsLoadingMessages(false)
      }
    }
  }, [])

  useEffect(() => {
    if (!selectedChannelId) {
      messageRequestIdRef.current += 1
      messagesChannelIdRef.current = null
      messagesReadyChannelIdRef.current = null
      setMessages([])
      setActiveThreadParent(null)
      setThreadReplies([])
      return
    }

    setActiveThreadParent(null)
    setThreadReplies([])
    void loadChannelMessages(selectedChannelId)
  }, [selectedChannelId, loadChannelMessages])

  useEffect(() => {
    if (!selectedChannelId) {
      setChannelParticipants([])
      setIsChannelPresenceReady(false)
      return
    }

    setChannelParticipants([])
    setIsChannelPresenceReady(false)
    void joinChannelPresence(selectedChannelId)

    return () => {
      leaveChannelPresence()
    }
  }, [selectedChannelId])

  const loadThread = useCallback(async (parentId: number) => {
    setIsLoadingThread(true)
    try {
      const result = await fetchThreadMessages(parentId)
      if (result.parent) {
        setActiveThreadParent(result.parent)
      }
      setThreadReplies(result.replies)
    } catch (error) {
      setBannerError(
        error instanceof Error && error.message
          ? error.message
          : '스레드 답글을 불러오지 못했습니다.',
      )
    } finally {
      setIsLoadingThread(false)
    }
  }, [])

  // 실시간 WebSocket 'CHAT' 이벤트 구독
  useEffect(() => {
    return subscribeToChatRealtimeEvents((event) => {
      const subType = event.subType.toUpperCase()
      const rawData = event.data
      const payloadRecord =
        rawData.payload && typeof rawData.payload === 'object'
          ? (rawData.payload as Record<string, unknown>)
          : rawData

      const eventChannelId = Number(
        payloadRecord.channel_id ?? payloadRecord.channelId ?? rawData.channel_id ?? 0,
      )
      const currentSelectedId = selectedChannelIdRef.current
      const currentThreadId = activeThreadParentIdRef.current

      // 채널 참여자 presence 는 사이드바 갱신과 무관하므로 CHANNEL 계열 분기보다 먼저 처리한다.
      if (subType === 'CHANNEL_PRESENCE') {
        if (eventChannelId === currentSelectedId) {
          setChannelParticipants(normalizeChannelParticipants(payloadRecord.participants))
          setIsChannelPresenceReady(true)
        }
        return
      }

      if (subType === 'CHANNEL_PRESENCE_ERROR') {
        if (eventChannelId === currentSelectedId) {
          setChannelParticipants([])
          setIsChannelPresenceReady(true)
        }
        return
      }

      // 채널 권한이 바뀌면 목록·관리 버튼이 달라지므로 사이드바를 다시 조회한다.
      if (subType === 'CHANNEL_ACCESS_CHANGED') {
        void loadSidebar()
        return
      }

      // 채널 생성/수정/삭제 이벤트인 경우 사이드바 전체 갱신
      if (
        subType.includes('CHANNEL') ||
        subType === 'DM_CREATED' ||
        !eventChannelId
      ) {
        void loadSidebar()
        return
      }

      const incomingMessage =
        payloadRecord.message_id !== undefined || payloadRecord.messageId !== undefined
          ? normalizeChatMessage(payloadRecord)
          : null

      if (eventChannelId === currentSelectedId) {
        if (incomingMessage) {
          if (subType === 'MESSAGE_DELETED') {
            // 삭제 이벤트도 메시지 전체 상태를 담고 온다. 답글이 남은 부모 메시지는 안내 문구로 유지한다.
            if (incomingMessage.parentMessageId === null) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.messageId === incomingMessage.messageId ? incomingMessage : m,
                ),
              )
            }

            if (currentThreadId) {
              if (
                currentThreadId === incomingMessage.messageId &&
                incomingMessage.parentMessageId === null &&
                incomingMessage.replyCount === 0
              ) {
                setActiveThreadParent(null)
                setThreadReplies([])
              } else {
                void loadThread(currentThreadId)
              }
            }

            // 답글 삭제는 부모의 replyCount도 바뀌므로 목록을 다시 맞춘다.
            if (incomingMessage.parentMessageId !== null) {
              void loadChannelMessages(eventChannelId)
            }
            void markChannelAsRead(eventChannelId)
            return
          }

          if (incomingMessage.parentMessageId === null) {
            setMessages((prev) => {
              const exists = prev.some((m) => m.messageId === incomingMessage.messageId)
              if (exists) {
                return prev.map((m) =>
                  m.messageId === incomingMessage.messageId ? incomingMessage : m,
                )
              }
              return [...prev, incomingMessage].sort((a, b) => a.messageId - b.messageId)
            })
            if (currentThreadId === incomingMessage.messageId) {
              setActiveThreadParent(incomingMessage)
            }
          } else {
            // 스레드 답글 이벤트인 경우 부모 메시지의 replyCount 갱신 및 활성 스레드 갱신
            const parentId = incomingMessage.parentMessageId
            if (currentThreadId === parentId) {
              void loadThread(parentId)
            }
            void loadChannelMessages(eventChannelId)
          }
          void markChannelAsRead(eventChannelId)
        } else {
          void loadChannelMessages(eventChannelId)
          if (currentThreadId) {
            void loadThread(currentThreadId)
          }
        }
      } else {
        // 다른 채널의 메시지인 경우 사이드바 Unread 카운트 동기화
        void loadSidebar()
      }
    })
  }, [loadSidebar, loadChannelMessages, loadThread])

  const workspaceGroups = useMemo<WorkspaceGroup[]>(() => {
    const groupMap = new Map<number, WorkspaceGroup>()
    const userId = currentUser?.userId ?? ''

    // 로컬 스냅샷에서 CHANNEL_MANAGE 권한을 가진 공유 노드도 파악
    const nodeManageMap = new Map<number, boolean>()
    if (userId) {
      snapshot.roles
        .filter((r) => !r.isDeleted && r.userId === userId)
        .forEach((role) => {
          const authDef = (snapshot.authorities ?? []).find(
            (a) => a.nodeId === role.nodeId && a.roleName === role.roleName,
          )
          const mask = authDef?.authority ?? ''
          const bits = parseAuthorityBitSet(mask)
          if (bits.has(27) || role.roleName === 'ADMIN' || role.roleName === 'MANAGER') {
            nodeManageMap.set(role.nodeId, true)
          }
        })
    }

    workspaceChannels.forEach((ch) => {
      const existing = groupMap.get(ch.ownerNodeId)
      const canManage = ch.canManage || Boolean(nodeManageMap.get(ch.ownerNodeId))
      if (existing) {
        existing.channels.push(ch)
        if (canManage) existing.canManage = true
        if (!existing.nodeType && ch.ownerNodeType) existing.nodeType = ch.ownerNodeType
      } else {
        groupMap.set(ch.ownerNodeId, {
          nodeId: ch.ownerNodeId,
          nodeName: ch.ownerNodeName,
          nodeType: ch.ownerNodeType,
          canManage,
          channels: [ch],
        })
      }
    })

    // 채널 정렬: 기본 채널(#일반) 우선, 그 외 이름순
    groupMap.forEach((group) => {
      group.channels.sort((a, b) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1
        return a.name.localeCompare(b.name, 'ko')
      })
    })

    return Array.from(groupMap.values())
  }, [workspaceChannels, currentUser?.userId, snapshot.roles, snapshot.authorities])

  const manageableWorkspaces = useMemo<ManageableWorkspaceOption[]>(() => {
    return workspaceGroups
      .filter((g) => g.canManage)
      .map((g) => ({ nodeId: g.nodeId, nodeName: g.nodeName }))
  }, [workspaceGroups])

  const selectedChannel = useMemo<ChannelItem | null>(() => {
    if (!selectedChannelId) return null
    return (
      workspaceChannels.find((c) => c.channelId === selectedChannelId) ??
      dmChannels.find((d) => d.channelId === selectedChannelId) ??
      null
    )
  }, [selectedChannelId, workspaceChannels, dmChannels])

  function handleSelectChannel(channelId: number) {
    if (selectedChannelIdRef.current === channelId) {
      return
    }

    setSelectedChannelId(channelId)

    const cached = readCachedChannelMessages(channelId)
    messagesChannelIdRef.current = channelId
    messagesReadyChannelIdRef.current = cached ? channelId : null
    setMessages(cached ?? [])
    setIsLoadingMessages(cached === null)

    setSearchParams({ channelId: String(channelId) }, { replace: true })
  }

  async function handleSendMainMessage(content: string, attachedFiles: File[]) {
    if (!selectedChannel) return
    setBannerError(null)

    const fallbackText =
      content ||
      (attachedFiles.length === 1
        ? `[첨부파일] ${attachedFiles[0].name}`
        : `[첨부파일 ${attachedFiles.length}개]`)

    let latestMsg = await sendChatMessage(selectedChannel.channelId, fallbackText, null)

    for (const file of attachedFiles) {
      const updated = await uploadChatMessageFile(latestMsg.messageId, file)
      if (updated) {
        latestMsg = updated
      }
    }

    setMessages((prev) => {
      const exists = prev.some((m) => m.messageId === latestMsg.messageId)
      if (exists) {
        return prev.map((m) => (m.messageId === latestMsg.messageId ? latestMsg : m))
      }
      return [...prev, latestMsg].sort((a, b) => a.messageId - b.messageId)
    })
  }

  async function handleSendThreadReply(content: string, attachedFiles: File[]) {
    if (!selectedChannel || !activeThreadParent) return
    setBannerError(null)

    const fallbackText =
      content ||
      (attachedFiles.length === 1
        ? `[첨부파일] ${attachedFiles[0].name}`
        : `[첨부파일 ${attachedFiles.length}개]`)

    let latestReply = await sendChatMessage(
      selectedChannel.channelId,
      fallbackText,
      activeThreadParent.messageId,
    )

    for (const file of attachedFiles) {
      const updated = await uploadChatMessageFile(latestReply.messageId, file)
      if (updated) {
        latestReply = updated
      }
    }

    setThreadReplies((prev) => {
      const exists = prev.some((r) => r.messageId === latestReply.messageId)
      if (exists) {
        return prev.map((r) => (r.messageId === latestReply.messageId ? latestReply : r))
      }
      return [...prev, latestReply].sort((a, b) => a.messageId - b.messageId)
    })

    // 부모 메시지의 답글 수 즉시 반영
    setMessages((prev) =>
      prev.map((m) =>
        m.messageId === activeThreadParent.messageId
          ? {
              ...m,
              replyCount: m.replyCount + 1,
              lastReplyAt: latestReply.createdAt,
            }
          : m,
      ),
    )
  }

  async function handleEditMessage(messageId: number, content: string) {
    const updated = await updateChatMessage(messageId, content)
    setMessages((prev) => prev.map((m) => (m.messageId === messageId ? updated : m)))
    setThreadReplies((prev) => prev.map((r) => (r.messageId === messageId ? updated : r)))
    if (activeThreadParent?.messageId === messageId) {
      setActiveThreadParent(updated)
    }
  }

  async function handleDeleteMessage(messageId: number) {
    const channelId = selectedChannelIdRef.current
    const threadParentId = activeThreadParentIdRef.current
    await deleteChatMessage(messageId)

    if (channelId) {
      await loadChannelMessages(channelId)
    }

    if (!threadParentId) return

    try {
      const result = await fetchThreadMessages(threadParentId)
      if (!result.parent || (result.parent.isDeleted && result.replies.length === 0)) {
        setActiveThreadParent(null)
        setThreadReplies([])
        return
      }
      setActiveThreadParent(result.parent)
      setThreadReplies(result.replies)
    } catch {
      setActiveThreadParent(null)
      setThreadReplies([])
    }
  }

  function handleOpenThread(message: ChatMessage) {
    setActiveThreadParent(message)
    void loadThread(message.messageId)
  }

  async function handleChannelFormSubmit(payload: {
    nodeId: number
    name: string
    description: string
  }) {
    if (
      channelModalMode === 'edit' &&
      selectedChannel &&
      selectedChannel.channelType === 'WORKSPACE'
    ) {
      const updated = await updateWorkspaceChannel(
        selectedChannel.channelId,
        payload.name,
        payload.description,
      )
      setWorkspaceChannels((prev) =>
        prev.map((ch) => (ch.channelId === updated.channelId ? updated : ch)),
      )
    } else {
      const created = await createWorkspaceChannel(
        payload.nodeId,
        payload.name,
        payload.description,
      )
      await loadSidebar()
      handleSelectChannel(created.channelId)
    }
  }

  async function handleDeleteChannel() {
    if (
      !selectedChannel ||
      selectedChannel.channelType !== 'WORKSPACE' ||
      selectedChannel.isDefault
    ) {
      return
    }

    const confirmed = window.confirm(
      `#${selectedChannel.name} 채널을 삭제하시겠습니까? 채널 내 대화 내역에 더 이상 접근할 수 없습니다.`,
    )
    if (!confirmed) return

    try {
      await deleteWorkspaceChannel(selectedChannel.channelId)
      removeCachedChannelMessages(selectedChannel.channelId)
      setSelectedChannelId(null)
      await loadSidebar()
    } catch (error) {
      setBannerError(
        error instanceof Error && error.message
          ? error.message
          : '채널을 삭제하지 못했습니다.',
      )
    }
  }

  async function handleStartDm(targetEmail: string) {
    const dm = await openOrCreateDmChannel(targetEmail)
    await loadSidebar()
    handleSelectChannel(dm.channelId)
  }

  if (!currentUser) {
    return null
  }

  return (
    <div className={styles.page}>
      {bannerError ? (
        <div className={styles.errorBanner} role="alert">
          <span>{bannerError}</span>
          <button
            type="button"
            className={styles.errorDismiss}
            onClick={() => setBannerError(null)}
          >
            닫기
          </button>
        </div>
      ) : null}

      <div className={styles.layout}>
        <ChannelSidebar
          workspaceGroups={workspaceGroups}
          dmChannels={dmChannels}
          selectedChannelId={selectedChannelId}
          onSelectChannel={handleSelectChannel}
          onOpenCreateChannelModal={(nodeId) => {
            setModalInitialNodeId(nodeId)
            setChannelModalMode('create')
          }}
          onOpenNewDmModal={() => setIsNewDmModalOpen(true)}
        />

        <ChannelMainChat
          channel={selectedChannel}
          messages={messages}
          participants={channelParticipants}
          isPresenceReady={isChannelPresenceReady}
          currentUserId={currentUser.userId}
          currentUserEmail={currentUser.email}
          activeThreadParentId={activeThreadParent?.messageId ?? null}
          isLoadingMessages={isLoadingMessages}
          onSendMessage={handleSendMainMessage}
          onEditMessage={handleEditMessage}
          onDeleteMessage={handleDeleteMessage}
          onOpenThread={handleOpenThread}
          onOpenEditChannelModal={() => setChannelModalMode('edit')}
          onDeleteChannel={() => void handleDeleteChannel()}
          onOpenNewDmModal={() => setIsNewDmModalOpen(true)}
        />

        {selectedChannel && activeThreadParent ? (
          <ChannelThreadPanel
            channel={selectedChannel}
            parentMessage={activeThreadParent}
            replies={threadReplies}
            currentUserId={currentUser.userId}
            currentUserEmail={currentUser.email}
            isLoading={isLoadingThread}
            onClose={() => {
              setActiveThreadParent(null)
              setThreadReplies([])
            }}
            onSendReply={handleSendThreadReply}
            onEditReply={handleEditMessage}
            onDeleteReply={handleDeleteMessage}
          />
        ) : null}
      </div>

      <ChannelFormModal
        mode={channelModalMode ?? 'create'}
        isOpen={channelModalMode !== null}
        manageableWorkspaces={manageableWorkspaces}
        initialNodeId={modalInitialNodeId}
        editingChannel={
          channelModalMode === 'edit' &&
          selectedChannel?.channelType === 'WORKSPACE'
            ? selectedChannel
            : null
        }
        onClose={() => setChannelModalMode(null)}
        onSubmit={handleChannelFormSubmit}
      />

      <NewDmModal
        isOpen={isNewDmModalOpen}
        currentUserEmail={currentUser.email}
        knownUsers={snapshot.users}
        onClose={() => setIsNewDmModalOpen(false)}
        onStartDm={handleStartDm}
      />
    </div>
  )
}
