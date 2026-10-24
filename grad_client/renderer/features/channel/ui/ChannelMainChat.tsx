import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../../design-system/primitives/Icon'
import { UserAvatar } from '../../../design-system/primitives/UserAvatar'
import type { ChannelItem, ChannelParticipant, ChatMessage } from '../model/channelTypes'
import { ChannelPresence } from './ChannelPresence'
import { ChatFileAttachments } from './ChatFileAttachments'
import { ChatMessageComposer } from './ChatMessageComposer'
import { ChatMessageText } from './ChatMessageText'
import styles from './ChannelMainChat.module.css'

export type ChannelMainChatProps = {
  channel: ChannelItem | null
  messages: ChatMessage[]
  participants: ChannelParticipant[]
  isPresenceReady: boolean
  currentUserId: string
  currentUserEmail: string
  activeThreadParentId: number | null
  isLoadingMessages: boolean
  onSendMessage: (content: string, files: File[]) => Promise<void>
  onEditMessage: (messageId: number, content: string) => Promise<void>
  onDeleteMessage: (messageId: number) => Promise<void>
  onOpenThread: (message: ChatMessage) => void
  onOpenChannelPopup?: () => void
  onOpenEditChannelModal: () => void
  onDeleteChannel: () => void
  onOpenNewDmModal: () => void
}

const DATE_DIVIDER_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
  weekday: 'long',
})

const TIME_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  hour: 'numeric',
  minute: '2-digit',
})

function formatDateKey(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return 'unknown'
  const y = parsed.getFullYear()
  const m = String(parsed.getMonth() + 1).padStart(2, '0')
  const d = String(parsed.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function formatDateHeading(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return ''
  return DATE_DIVIDER_FORMATTER.format(parsed)
}

function formatMessageTime(iso: string | null): string {
  if (!iso) return ''
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return ''
  return TIME_FORMATTER.format(parsed)
}

export function ChannelMainChat({
  channel,
  messages,
  participants,
  isPresenceReady,
  currentUserId,
  currentUserEmail,
  activeThreadParentId,
  isLoadingMessages,
  onSendMessage,
  onEditMessage,
  onDeleteMessage,
  onOpenThread,
  onOpenChannelPopup,
  onOpenEditChannelModal,
  onDeleteChannel,
  onOpenNewDmModal,
}: ChannelMainChatProps) {
  const [editingMessageId, setEditingMessageId] = useState<number | null>(null)
  const [editingDraft, setEditingDraft] = useState('')
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const feedEndRef = useRef<HTMLDivElement>(null)

  const visibleMessages = useMemo(
    () => messages.filter((msg) => !msg.isDeleted || msg.replyCount > 0),
    [messages],
  )

  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [channel?.channelId, visibleMessages.length])

  useEffect(() => {
    setEditingMessageId(null)
    setEditingDraft('')
  }, [channel?.channelId])

  if (!channel) {
    return (
      <section className={styles.emptyPanel} aria-label="채널 선택 안내">
        <div className={styles.emptyCard}>
          <span className={styles.emptyIconCircle} aria-hidden="true">
            <Icon name="messageCircle" size={26} />
          </span>
          <h2 className={styles.emptyTitle}>채널 또는 대화 상대를 선택하세요</h2>
          <p className={styles.emptyDesc}>
            좌측 목록에서 워크스페이스 팀 채널을 선택하거나, 동료의 이메일로 1:1 다이렉트 메시지를 시작할 수 있습니다.
          </p>
          <button
            type="button"
            className={styles.emptyActionBtn}
            onClick={onOpenNewDmModal}
          >
            <Icon name="mail" size={16} />
            <span>이메일로 1:1 대화 시작하기</span>
          </button>
        </div>
      </section>
    )
  }

  const isWorkspaceChannel = channel.channelType === 'WORKSPACE'
  const composerPlaceholder = isWorkspaceChannel
    ? `#${channel.name}에 메시지 보내기...`
    : `${channel.counterpartName}님에게 메시지 보내기...`

  function isOwnMessage(msg: ChatMessage): boolean {
    const normCurrentEmail = currentUserEmail.trim().toLowerCase()
    const normMsgEmail = msg.senderEmail.trim().toLowerCase()
    if (normCurrentEmail && normMsgEmail && normCurrentEmail === normMsgEmail) {
      return true
    }
    return Boolean(currentUserId && msg.senderUserId === currentUserId)
  }

  async function handleSaveEdit(messageId: number) {
    const trimmed = editingDraft.trim()
    if (!trimmed || isSavingEdit) return
    setIsSavingEdit(true)
    try {
      await onEditMessage(messageId, trimmed)
      setEditingMessageId(null)
      setEditingDraft('')
    } finally {
      setIsSavingEdit(false)
    }
  }

  return (
    <section className={styles.mainChat} aria-label="채팅 대화창">
      {/* 상단 채널/DM 헤더 */}
      <header className={styles.header}>
        {isWorkspaceChannel ? (
          <div className={styles.headerInfo}>
            <div className={styles.headerTitleRow}>
              <span className={styles.channelHash} aria-hidden="true">
                #
              </span>
              <h2 className={styles.headerTitle}>{channel.name}</h2>
              <span className={styles.workspaceBadge}>
                <Icon name="building" size={13} />
                <span>{channel.ownerNodeName}</span>
              </span>
              {channel.isDefault ? (
                <span className={styles.defaultBadge}>기본 채널</span>
              ) : null}
            </div>
            {channel.description ? (
              <p className={styles.headerDesc}>{channel.description}</p>
            ) : null}
          </div>
        ) : (
          <div className={styles.headerDmInfo}>
            <UserAvatar
              name={channel.counterpartName}
              userId={channel.counterpartUserId || channel.counterpartEmail}
              size="medium"
            />
            <div className={styles.headerInfo}>
              <div className={styles.headerTitleRow}>
                <h2 className={styles.headerTitle}>{channel.counterpartName}</h2>
                <span className={styles.dmBadge}>1:1 DM</span>
              </div>
              <p className={styles.headerDesc}>{channel.counterpartEmail}</p>
            </div>
          </div>
        )}

        <div className={styles.headerRight}>
          {onOpenChannelPopup ? (
            <button
              type="button"
              className={styles.headerActionBtn}
              onClick={onOpenChannelPopup}
              title="채널을 별도 창으로 열기"
            >
              <Icon name="maximize2" size={14} />
              <span>새 창</span>
            </button>
          ) : null}

          <ChannelPresence
            channelId={channel.channelId}
            channelType={channel.channelType}
            participants={participants}
            isPresenceReady={isPresenceReady}
            currentUserEmail={currentUserEmail}
            counterpartEmail={
              channel.channelType === 'DM' ? channel.counterpartEmail : undefined
            }
          />

          {isWorkspaceChannel && channel.canManage ? (
            <div className={styles.headerActions}>
              <button
                type="button"
                className={styles.headerActionBtn}
                onClick={onOpenEditChannelModal}
              >
                <Icon name="pencil" size={14} />
                <span>채널 수정</span>
              </button>
              {!channel.isDefault ? (
                <button
                  type="button"
                  className={`${styles.headerActionBtn} ${styles.headerDangerBtn}`}
                  onClick={onDeleteChannel}
                >
                  <Icon name="trash" size={14} />
                  <span>채널 삭제</span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </header>

      {/* 중앙 메시지 타임라인 피드 */}
      <div className={styles.feed}>
        {isLoadingMessages && visibleMessages.length === 0 ? (
          <div className={styles.feedState}>메시지를 불러오는 중입니다...</div>
        ) : visibleMessages.length === 0 ? (
          <div className={styles.feedWelcome}>
            <span className={styles.welcomeIcon} aria-hidden="true">
              <Icon name={isWorkspaceChannel ? 'messageCircle' : 'mail'} size={24} />
            </span>
            <h3 className={styles.welcomeTitle}>
              {isWorkspaceChannel
                ? `#${channel.name} 채널의 시작입니다.`
                : `${channel.counterpartName}님과의 1:1 대화방입니다.`}
            </h3>
            <p className={styles.welcomeDesc}>
              {isWorkspaceChannel
                ? channel.description || '팀원들에게 첫 번째 메시지와 파일을 공유해 보세요.'
                : `${channel.counterpartEmail} 계정으로 실시간 메시지와 파일을 주고받을 수 있습니다.`}
            </p>
          </div>
        ) : (
          visibleMessages.map((msg, index) => {
            const prevMsg = index > 0 ? visibleMessages[index - 1] : null
            const currDateKey = formatDateKey(msg.createdAt)
            const prevDateKey = prevMsg ? formatDateKey(prevMsg.createdAt) : null
            const showDateDivider = currDateKey !== prevDateKey
            const isMine = isOwnMessage(msg)
            const canDelete = isMine || (isWorkspaceChannel && channel.canManage)
            const isEditing = !msg.isDeleted && editingMessageId === msg.messageId
            const isThreadActive = activeThreadParentId === msg.messageId

            return (
              <div key={msg.messageId} className={styles.messageBlock}>
                {showDateDivider ? (
                  <div className={styles.dateDivider} role="separator">
                    <span className={styles.dateDividerText}>
                      {formatDateHeading(msg.createdAt)}
                    </span>
                  </div>
                ) : null}

                <article
                  className={styles.messageItem}
                  data-thread-open={isThreadActive ? 'true' : undefined}
                >
                  <div className={styles.avatarCol}>
                    <UserAvatar
                      name={msg.senderName}
                      userId={msg.senderUserId || msg.senderEmail}
                      size="medium"
                    />
                  </div>

                  <div className={styles.messageBody}>
                    <div className={styles.messageMeta}>
                      <strong className={styles.senderName}>{msg.senderName}</strong>
                      {msg.senderEmail ? (
                        <span className={styles.senderEmail}>{msg.senderEmail}</span>
                      ) : null}
                      <time className={styles.timestamp} dateTime={msg.createdAt}>
                        {formatMessageTime(msg.createdAt)}
                      </time>
                      {msg.isEdited ? (
                        <span className={styles.editedTag}>(수정됨)</span>
                      ) : null}
                    </div>

                    {isEditing ? (
                      <div className={styles.editForm}>
                        <textarea
                          rows={2}
                          className={styles.editTextarea}
                          value={editingDraft}
                          disabled={isSavingEdit}
                          onChange={(e) => setEditingDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault()
                              void handleSaveEdit(msg.messageId)
                            } else if (e.key === 'Escape') {
                              setEditingMessageId(null)
                              setEditingDraft('')
                            }
                          }}
                        />
                        <div className={styles.editActions}>
                          <button
                            type="button"
                            className={styles.editCancelBtn}
                            onClick={() => {
                              setEditingMessageId(null)
                              setEditingDraft('')
                            }}
                          >
                            취소
                          </button>
                          <button
                            type="button"
                            className={styles.editSaveBtn}
                            disabled={!editingDraft.trim() || isSavingEdit}
                            onClick={() => void handleSaveEdit(msg.messageId)}
                          >
                            {isSavingEdit ? '저장 중...' : '저장'}
                          </button>
                        </div>
                      </div>
                    ) : msg.isDeleted ? (
                      <p className={styles.deletedMessageText}>삭제된 메시지입니다.</p>
                    ) : msg.content ? (
                      <ChatMessageText content={msg.content} className={styles.messageText} />
                    ) : null}

                    <ChatFileAttachments files={msg.files} />

                    {msg.replyCount > 0 ? (
                      <button
                        type="button"
                        className={styles.threadSummaryButton}
                        onClick={() => onOpenThread(msg)}
                      >
                        <Icon name="messageCircle" size={14} />
                        <span className={styles.threadCountText}>
                          답글 {msg.replyCount}개
                        </span>
                        {msg.lastReplyAt ? (
                          <span className={styles.threadLastTime}>
                            마지막 답글 {formatMessageTime(msg.lastReplyAt)}
                          </span>
                        ) : null}
                        {msg.replySenders.length > 0 ? (
                          <span className={styles.threadSenders}>
                            {msg.replySenders.slice(0, 3).map((sender) => sender.name).join(', ')}
                            {msg.replySenders.length > 3
                              ? ` 외 ${msg.replySenders.length - 3}명`
                              : ''}
                          </span>
                        ) : null}
                        <Icon name="chevronRight" size={13} />
                      </button>
                    ) : null}
                  </div>

                  {/* 호버 액션 툴바 */}
                  {!isEditing && !msg.isDeleted ? (
                    <div className={styles.hoverToolbar} aria-label="메시지 작업">
                      <button
                        type="button"
                        className={styles.toolbarBtn}
                        title="스레드 답글 달기"
                        onClick={() => onOpenThread(msg)}
                      >
                        <Icon name="messageCircle" size={14} />
                        <span>답글</span>
                      </button>

                      {isMine ? (
                        <button
                          type="button"
                          className={styles.toolbarBtn}
                          title="메시지 수정"
                          onClick={() => {
                            setEditingMessageId(msg.messageId)
                            setEditingDraft(msg.content)
                          }}
                        >
                          <Icon name="pencil" size={14} />
                          <span>수정</span>
                        </button>
                      ) : null}

                      {canDelete ? (
                        <button
                          type="button"
                          className={`${styles.toolbarBtn} ${styles.toolbarDangerBtn}`}
                          title="메시지 삭제"
                          onClick={() => void onDeleteMessage(msg.messageId)}
                        >
                          <Icon name="trash" size={14} />
                          <span>삭제</span>
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              </div>
            )
          })
        )}
        <div ref={feedEndRef} />
      </div>

      {/* 하단 메시지 입력창 */}
      <footer className={styles.composerArea}>
        <ChatMessageComposer
          placeholder={composerPlaceholder}
          canChat={channel.canChat}
          onSend={onSendMessage}
        />
      </footer>
    </section>
  )
}
