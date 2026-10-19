import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../../design-system/primitives/Icon'
import { UserAvatar } from '../../../design-system/primitives/UserAvatar'
import type { ChannelItem, ChatMessage } from '../model/channelTypes'
import { ChatFileAttachments } from './ChatFileAttachments'
import { ChatMessageComposer } from './ChatMessageComposer'
import { ChatMessageText } from './ChatMessageText'
import styles from './ChannelThreadPanel.module.css'

export type ChannelThreadPanelProps = {
  channel: ChannelItem
  parentMessage: ChatMessage
  replies: ChatMessage[]
  currentUserId: string
  currentUserEmail: string
  isLoading: boolean
  onClose: () => void
  onSendReply: (content: string, files: File[]) => Promise<void>
  onEditReply: (messageId: number, content: string) => Promise<void>
  onDeleteReply: (messageId: number) => Promise<void>
}

const TIME_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

function formatThreadTime(iso: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return ''
  return TIME_FORMATTER.format(parsed)
}

export function ChannelThreadPanel({
  channel,
  parentMessage,
  replies,
  currentUserId,
  currentUserEmail,
  isLoading,
  onClose,
  onSendReply,
  onEditReply,
  onDeleteReply,
}: ChannelThreadPanelProps) {
  const [editingReplyId, setEditingReplyId] = useState<number | null>(null)
  const [editingDraft, setEditingDraft] = useState('')
  const [isSavingEdit, setIsSavingEdit] = useState(false)
  const repliesEndRef = useRef<HTMLDivElement>(null)

  const liveReplyCount = useMemo(
    () => replies.filter((reply) => !reply.isDeleted).length,
    [replies],
  )

  useEffect(() => {
    repliesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [parentMessage.messageId, replies.length])

  useEffect(() => {
    setEditingReplyId(null)
    setEditingDraft('')
  }, [parentMessage.messageId])

  const channelLabel =
    channel.channelType === 'WORKSPACE'
      ? `#${channel.name}`
      : channel.counterpartName

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
      await onEditReply(messageId, trimmed)
      setEditingReplyId(null)
      setEditingDraft('')
    } finally {
      setIsSavingEdit(false)
    }
  }

  return (
    <aside className={styles.panel} aria-label="스레드 답글 패널">
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <h3 className={styles.headerTitle}>스레드</h3>
          <span className={styles.channelBadge}>{channelLabel}</span>
        </div>

        <button
          type="button"
          className={styles.closeButton}
          aria-label="스레드 닫기"
          onClick={onClose}
        >
          <Icon name="close" size={16} />
        </button>
      </header>

      <div className={styles.scrollBody}>
        {/* 원본 메시지 카드 */}
        <article className={styles.parentCard}>
          <div className={styles.messageRow}>
            <UserAvatar
              name={parentMessage.senderName}
              userId={parentMessage.senderUserId || parentMessage.senderEmail}
              size="medium"
            />
            <div className={styles.messageBody}>
              <div className={styles.messageMeta}>
                <strong className={styles.senderName}>{parentMessage.senderName}</strong>
                <time className={styles.timestamp} dateTime={parentMessage.createdAt}>
                  {formatThreadTime(parentMessage.createdAt)}
                </time>
                {parentMessage.isEdited ? (
                  <span className={styles.editedTag}>(수정됨)</span>
                ) : null}
              </div>

              {parentMessage.isDeleted ? (
                <p className={styles.deletedMessageText}>삭제된 메시지입니다.</p>
              ) : parentMessage.content ? (
                <ChatMessageText content={parentMessage.content} className={styles.messageText} />
              ) : null}

              <ChatFileAttachments files={parentMessage.files} />
            </div>
          </div>
        </article>

        {/* 답글 수 구분선 */}
        <div className={styles.replyDivider} role="separator">
          <span>답글 {liveReplyCount}개</span>
        </div>

        {/* 답글 목록 */}
        {isLoading ? (
          <p className={styles.stateText}>스레드 답글을 불러오는 중입니다...</p>
        ) : replies.length === 0 ? (
          <p className={styles.stateText}>아직 등록된 답글이 없습니다. 첫 답글을 남겨보세요.</p>
        ) : (
          <div className={styles.replyList}>
            {replies.map((reply) => {
              const isMine = isOwnMessage(reply)
              const canDelete =
                isMine || (channel.channelType === 'WORKSPACE' && channel.canManage)
              const isEditing = !reply.isDeleted && editingReplyId === reply.messageId

              return (
                <article key={reply.messageId} className={styles.replyItem}>
                  <UserAvatar
                    name={reply.senderName}
                    userId={reply.senderUserId || reply.senderEmail}
                    size="small"
                  />
                  <div className={styles.messageBody}>
                    <div className={styles.messageMeta}>
                      <strong className={styles.senderName}>{reply.senderName}</strong>
                      <time className={styles.timestamp} dateTime={reply.createdAt}>
                        {formatThreadTime(reply.createdAt)}
                      </time>
                      {reply.isEdited ? (
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
                              void handleSaveEdit(reply.messageId)
                            } else if (e.key === 'Escape') {
                              setEditingReplyId(null)
                              setEditingDraft('')
                            }
                          }}
                        />
                        <div className={styles.editActions}>
                          <button
                            type="button"
                            className={styles.editCancelBtn}
                            onClick={() => {
                              setEditingReplyId(null)
                              setEditingDraft('')
                            }}
                          >
                            취소
                          </button>
                          <button
                            type="button"
                            className={styles.editSaveBtn}
                            disabled={!editingDraft.trim() || isSavingEdit}
                            onClick={() => void handleSaveEdit(reply.messageId)}
                          >
                            저장
                          </button>
                        </div>
                      </div>
                    ) : reply.isDeleted ? (
                      <p className={styles.deletedMessageText}>삭제된 메시지입니다.</p>
                    ) : reply.content ? (
                      <ChatMessageText content={reply.content} className={styles.messageText} />
                    ) : null}

                    <ChatFileAttachments files={reply.files} />
                  </div>

                  {!isEditing && !reply.isDeleted && (isMine || canDelete) ? (
                    <div className={styles.replyActions}>
                      {isMine ? (
                        <button
                          type="button"
                          className={styles.replyActionBtn}
                          title="답글 수정"
                          onClick={() => {
                            setEditingReplyId(reply.messageId)
                            setEditingDraft(reply.content)
                          }}
                        >
                          <Icon name="pencil" size={13} />
                        </button>
                      ) : null}
                      {canDelete ? (
                        <button
                          type="button"
                          className={`${styles.replyActionBtn} ${styles.replyDangerBtn}`}
                          title="답글 삭제"
                          onClick={() => void onDeleteReply(reply.messageId)}
                        >
                          <Icon name="trash" size={13} />
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        )}
        <div ref={repliesEndRef} />
      </div>

      <footer className={styles.composerArea}>
        <ChatMessageComposer
          placeholder="스레드에 답글 남기기..."
          canChat={channel.canChat}
          compact
          onSend={onSendReply}
        />
      </footer>
    </aside>
  )
}
